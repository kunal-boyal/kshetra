import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CreatePlanBody,
  PLAN_LIMIT_KEYS,
  type PlanBody,
  type PlanLimitValues,
  type PlanResult,
} from '@thelamp/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { plans, tenants } from '../../db/schema/directory';
import type { StaffAccess } from '../../platform/auth';
import { DirectoryDatabase } from '../directory/directory.database';
import { PlatformAudit } from '../directory/platform-audit';
import { EntitlementsService } from './entitlements.service';

type PlanRow = typeof plans.$inferSelect;

/**
 * Plans (spec 5.13, module M23, decision D89): what tenants buy, as data the console keeps. A
 * plan's key never changes; a plan in use is switched off rather than removed.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly audit: PlatformAudit,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(): Promise<PlanResult[]> {
    const rows = await this.database.db
      .select({ plan: plans, tenants: sql<number>`count(${tenants.id})::int` })
      .from(plans)
      .leftJoin(tenants, eq(tenants.planId, plans.id))
      .groupBy(plans.id)
      .orderBy(asc(plans.priceMonth), asc(plans.key));
    return rows.map(({ plan, tenants: count }) => result(plan, count));
  }

  async get(id: string): Promise<PlanResult> {
    const found = (await this.list()).find((plan) => plan.id === id);
    if (!found) throw new AppError('NOT_FOUND', 'There is no such plan.');
    return found;
  }

  /** Adds a plan. The same create again answers with the plan it made. */
  async create(by: StaffAccess, body: CreatePlanBody): Promise<PlanResult> {
    const [existing] = await this.database.db.select().from(plans).where(eq(plans.id, body.id));
    if (existing) {
      if (existing.key !== body.key) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'This ID was used for another plan.');
      }
      return this.get(body.id);
    }
    await this.database.db.transaction(async (tx) => {
      const [taken] = await tx.select({ id: plans.id }).from(plans).where(eq(plans.key, body.key));
      if (taken) {
        throw new AppError('CONFLICT', 'Another plan has this key.', [
          { path: 'key', issue: 'Already used by another plan' },
        ]);
      }
      await tx.insert(plans).values(values(body, body.id));
      await this.audit.record(tx, by, 'plan.created', 'plan', body.id, { key: body.key });
    });
    return this.get(body.id);
  }

  /**
   * Changes a plan; its key stays. Tenants on it follow at once: modules it no longer opens close
   * on their next request.
   */
  async update(by: StaffAccess, id: string, body: PlanBody): Promise<PlanResult> {
    await this.database.db.transaction(async (tx) => {
      const [current] = await tx.select().from(plans).where(eq(plans.id, id)).for('update');
      if (!current) throw new AppError('NOT_FOUND', 'There is no such plan.');
      if (current.key !== body.key) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'key', issue: 'A plan keeps its key' },
        ]);
      }
      await tx
        .update(plans)
        .set({ ...values(body, id), updatedAt: new Date() })
        .where(eq(plans.id, id));
      await this.audit.record(tx, by, 'plan.updated', 'plan', id, {
        before: result(current, 0),
        after: body,
      });
    });
    this.entitlements.forget();
    return this.get(id);
  }
}

function values(body: PlanBody, id: string) {
  return {
    id,
    key: body.key,
    name: body.name,
    priceMonth: body.priceMonth,
    priceYear: body.priceYear,
    modules: body.modules,
    limits: { users: body.limits.users, storageGb: body.limits.storageGb },
    addons: body.addons,
    active: body.active,
  };
}

function result(row: PlanRow, tenantCount: number): PlanResult {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    priceMonth: row.priceMonth,
    priceYear: row.priceYear,
    modules: row.modules,
    limits: Object.fromEntries(
      PLAN_LIMIT_KEYS.map((key) => [key, row.limits[key] ?? null]),
    ) as PlanLimitValues,
    addons: row.addons,
    active: row.active,
    tenants: tenantCount,
    createdAt: row.createdAt.toISOString(),
  };
}
