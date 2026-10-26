import { Injectable } from '@nestjs/common';
import {
  AppError,
  AVAILABLE_MODULES,
  type ModuleKey,
  PLAN_LIMIT_KEYS,
  type PlanLimitValues,
  SWITCHABLE_MODULES,
  type SwitchableModule,
  type TenantEntitlements,
  type TenantPlanBody,
} from '@thelamp/shared';
import { eq } from 'drizzle-orm';
import { plans, tenantEntitlements, tenants } from '../../db/schema/directory';
import type { StaffAccess } from '../../platform/auth';
import { type Entitled, Entitlements as EntitlementsSeam } from '../../platform/planes';
import { DirectoryDatabase } from '../directory/directory.database';
import { PlatformAudit } from '../directory/platform-audit';

/** How long a cell keeps a tenant's entitlements before asking again. */
const CACHE_MS = 30_000;

/**
 * A tenant's entitlements (spec 5.13, decision D89): its plan's modules and limits, with modules
 * added and limits changed for it alone. Without a plan every module stays open, as before
 * billing (D64). Cells ask on many requests, so answers are kept briefly; a change here forgets
 * them at once in this process, and other processes catch up within `CACHE_MS`.
 */
@Injectable()
export class EntitlementsService extends EntitlementsSeam {
  private readonly cache = new Map<string, { at: number; value: Entitled }>();

  constructor(
    private readonly database: DirectoryDatabase,
    private readonly audit: PlatformAudit,
  ) {
    super();
  }

  forget(): void {
    this.cache.clear();
  }

  async forTenant(tenantId: string): Promise<Entitled> {
    const kept = this.cache.get(tenantId);
    if (kept && Date.now() - kept.at < CACHE_MS) return kept.value;
    const value = this.entitled(await this.read(tenantId));
    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  /** What the console shows of a tenant's plan and entitlements. */
  async detail(tenantId: string): Promise<TenantEntitlements> {
    const found = await this.read(tenantId);
    const entitled = this.entitled(found);
    return {
      plan: found.plan ? { id: found.plan.id, key: found.plan.key, name: found.plan.name } : null,
      extraModules: found.extraModules as SwitchableModule[],
      modules: entitled.modules ? [...entitled.modules] : [...AVAILABLE_MODULES],
      limits: entitled.limits,
      ownLimits: found.limits,
    };
  }

  /** Puts a tenant on a plan, with modules added and limits changed for it alone. */
  /** `by` is null for the command line, such as the demo putting its tenant on a plan. */
  async set(
    by: StaffAccess | null,
    tenantId: string,
    body: TenantPlanBody,
  ): Promise<TenantEntitlements> {
    await this.database.db.transaction(async (tx) => {
      const [tenant] = await tx
        .select({ planId: tenants.planId })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for('update');
      if (!tenant) throw new AppError('NOT_FOUND', 'There is no such tenant.');
      if (body.planId) {
        const [plan] = await tx
          .select({ active: plans.active })
          .from(plans)
          .where(eq(plans.id, body.planId));
        if (!plan) throw new AppError('NOT_FOUND', 'There is no such plan.');
        if (!plan.active && body.planId !== tenant.planId) {
          throw new AppError('VALIDATION', 'Check the highlighted fields.', [
            { path: 'planId', issue: 'This plan is switched off' },
          ]);
        }
      }
      const before = await this.read(tenantId);
      await tx.update(tenants).set({ planId: body.planId }).where(eq(tenants.id, tenantId));
      const values = {
        extraModules: [...new Set(body.extraModules)],
        limits: body.limits,
        updatedAt: new Date(),
      };
      await tx
        .insert(tenantEntitlements)
        .values({ tenantId, ...values })
        .onConflictDoUpdate({ target: tenantEntitlements.tenantId, set: values });
      await this.audit.record(tx, by, 'tenant.plan_set', 'tenant', tenantId, {
        before: {
          planId: before.plan?.id ?? null,
          extraModules: before.extraModules,
          limits: before.limits,
        },
        after: body,
      });
    });
    this.cache.delete(tenantId);
    return this.detail(tenantId);
  }

  private async read(tenantId: string) {
    const [row] = await this.database.db
      .select({ plan: plans, extra: tenantEntitlements })
      .from(tenants)
      .leftJoin(plans, eq(plans.id, tenants.planId))
      .leftJoin(tenantEntitlements, eq(tenantEntitlements.tenantId, tenants.id))
      .where(eq(tenants.id, tenantId));
    return {
      plan: row?.plan ?? null,
      extraModules: row?.extra?.extraModules ?? [],
      limits: row?.extra?.limits ?? {},
    };
  }

  private entitled(found: Awaited<ReturnType<EntitlementsService['read']>>): Entitled {
    // The tenant's own limit where it has one (null lifts the cap), else the plan's.
    const limits = Object.fromEntries(
      PLAN_LIMIT_KEYS.map((key) => [
        key,
        found.limits[key] !== undefined ? found.limits[key] : (found.plan?.limits[key] ?? null),
      ]),
    ) as PlanLimitValues;
    if (!found.plan) return { modules: null, limits };
    const modules = new Set<ModuleKey>(['core', ...found.plan.modules]);
    for (const extra of found.extraModules) {
      if ((SWITCHABLE_MODULES as readonly string[]).includes(extra))
        modules.add(extra as ModuleKey);
    }
    return { modules: [...modules], limits };
  }
}
