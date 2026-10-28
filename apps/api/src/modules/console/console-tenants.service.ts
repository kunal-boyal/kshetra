import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CellSummary,
  addDays,
  BILLING_TIME_ZONE,
  type ConsoleTenant,
  type ConsoleTenantActivity,
  type ConsoleTenantQuery,
  type ConsoleTenantSummary,
  type CreateTenantBody,
  deletionDue,
  type TemplateSummary,
  type TenantStatus,
  todayIn,
} from '@thelamp/shared';
import { resolveTerminology } from '@thelamp/i18n';
import { loadTemplate, TEMPLATE_KEYS } from '@thelamp/templates';
import { and, asc, eq, gt, gte, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  cells,
  memberships,
  plans,
  refreshTokens,
  tenants,
  usageRecords,
} from '../../db/schema/directory';
import { startOfLocalDate } from '../../platform/local-day';
import { Entitlements } from '../../platform/planes';
import type { StaffAccess } from '../../platform/auth';
import { DirectoryDatabase } from '../directory/directory.database';
import { TenantProvisioner } from '../provisioning/provisioner';
import { PlatformAudit } from '../directory/platform-audit';

const DAY = 86_400_000;

const notFound = () => new AppError('NOT_FOUND', 'There is no such tenant.');

/**
 * Tenants as the console sees them (module M22, decision D88): every tenant in the directory with
 * its cell, template, trial and active users; created from a template with the first admin, and
 * suspended or reactivated. Suspending closes the tenant on everyone's next request (BR-39).
 */
@Injectable()
export class ConsoleTenantsService {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly provisioner: TenantProvisioner,
    private readonly audit: PlatformAudit,
    private readonly entitlements: Entitlements,
  ) {}

  async list(
    query: ConsoleTenantQuery,
  ): Promise<{ items: ConsoleTenant[]; nextCursor: string | null }> {
    const conditions: (SQL | undefined)[] = [
      query.status ? eq(tenants.status, query.status) : undefined,
      query.q
        ? or(ilike(tenants.name, `%${like(query.q)}%`), ilike(tenants.slug, `%${like(query.q)}%`))
        : undefined,
      query.cursor ? gt(tenants.slug, query.cursor) : undefined,
    ];
    const rows = await this.rows(and(...conditions), query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      items: page,
      nextCursor: rows.length > query.limit ? page.at(-1)!.slug : null,
    };
  }

  async get(id: string): Promise<ConsoleTenant> {
    const [row] = await this.rows(eq(tenants.id, id), 1);
    if (!row) throw notFound();
    return row;
  }

  /**
   * Creates a tenant from a template with its first admin, on this cell. The console names it,
   * so the same create again answers with the same tenant.
   */
  async create(by: StaffAccess, body: CreateTenantBody): Promise<ConsoleTenant> {
    const [existing] = await this.database.db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, body.id));
    if (existing) {
      if (existing.slug !== body.slug) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'This ID was used for another tenant.');
      }
      return this.get(body.id);
    }
    const { id, trialDays, planId, ...input } = body;
    if (planId) {
      const [plan] = await this.database.db
        .select({ active: plans.active })
        .from(plans)
        .where(eq(plans.id, planId));
      if (!plan?.active) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'planId', issue: plan ? 'This plan is switched off' : 'There is no such plan' },
        ]);
      }
    }
    await this.provisioner.provision(input, undefined, {
      tenantId: id,
      ...(input.status === 'trial' ? { trialEndsAt: new Date(Date.now() + trialDays * DAY) } : {}),
    });
    await this.database.db.transaction(async (tx) => {
      if (planId) await tx.update(tenants).set({ planId }).where(eq(tenants.id, id));
      await this.audit.record(tx, by, 'tenant.created', 'tenant', id, {
        slug: input.slug,
        template: input.template,
        status: input.status,
        planId,
      });
    });
    return this.get(id);
  }

  /** Closes the tenant: nobody signs in, and every session ends on its next request. */
  async suspend(by: StaffAccess, id: string, reason: string): Promise<ConsoleTenant> {
    return this.move(by, id, 'tenant.suspended', { reason }, (status) => {
      if (status === 'terminated') {
        throw new AppError('CONFLICT', 'A terminated tenant can’t be suspended.');
      }
      return 'suspended';
    });
  }

  /** Opens a suspended tenant again: on trial while its trial lasts, otherwise active. */
  async reactivate(by: StaffAccess, id: string): Promise<ConsoleTenant> {
    return this.move(by, id, 'tenant.reactivated', {}, (status, trialEndsAt) => {
      if (status !== 'suspended') {
        throw new AppError('CONFLICT', 'Only a suspended tenant can be reactivated.');
      }
      return trialEndsAt && trialEndsAt.getTime() > Date.now() ? 'trial' : 'active';
    });
  }

  /** Every tenant at once, as the tenants page's figures. */
  async summary(): Promise<ConsoleTenantSummary> {
    const now = new Date();
    // Columns named in full: a query without a join leaves its own unqualified, and inside a
    // subquery those would name the subquery's table.
    const active = sql.raw(
      `exists (select 1 from directory.subscriptions s where s.tenant_id = directory.tenants.id and s.status = 'active')`,
    );
    const [counts] = await this.database.db
      .select({
        tenants: sql<number>`count(*)::int`,
        demo: sql<number>`count(*) filter (where ${tenants.demo})::int`,
        suspended: sql<number>`count(*) filter (where ${tenants.status} = 'suspended')::int`,
        paying: sql<number>`count(*) filter (where not ${tenants.demo} and ${active})::int`,
        trial: sql<number>`count(*) filter (where ${tenants.trialEndsAt} > ${now} and not ${active})::int`,
      })
      .from(tenants)
      .where(isNull(tenants.deletedAt));
    const seats = await this.database.db
      .select({
        id: tenants.id,
        used: sql<number>`count(${memberships.id}) filter (where ${memberships.status} = 'active')::int`,
      })
      .from(tenants)
      .leftJoin(memberships, eq(memberships.tenantId, tenants.id))
      .where(isNull(tenants.deletedAt))
      .groupBy(tenants.id);
    const limits = await Promise.all(seats.map((row) => this.seatLimit(row.id)));
    const [today] = await this.database.db
      .select({ count: sql<number>`count(distinct ${memberships.userId})::int` })
      .from(refreshTokens)
      .innerJoin(memberships, eq(memberships.id, refreshTokens.membershipId))
      .where(
        gte(
          refreshTokens.createdAt,
          startOfLocalDate(todayIn(BILLING_TIME_ZONE, now), BILLING_TIME_ZONE),
        ),
      );
    return {
      tenants: counts?.tenants ?? 0,
      paying: counts?.paying ?? 0,
      trial: counts?.trial ?? 0,
      demo: counts?.demo ?? 0,
      suspended: counts?.suspended ?? 0,
      seatsInUse: seats.reduce((sum, row) => sum + row.used, 0),
      seatsBought: limits.reduce<number>((sum, limit) => sum + (limit ?? 0), 0),
      activeToday: today?.count ?? 0,
    };
  }

  /** The people active on each of a tenant's last 30 days, and its storage this month. */
  async activity(id: string): Promise<ConsoleTenantActivity> {
    await this.get(id);
    const today = todayIn(BILLING_TIME_ZONE, new Date());
    const first = addDays(today, -29);
    const rows = await this.database.db
      .select({
        date: sql<string>`to_char(${refreshTokens.createdAt} at time zone ${BILLING_TIME_ZONE}, 'YYYY-MM-DD')`,
        active: sql<number>`count(distinct ${memberships.userId})::int`,
      })
      .from(refreshTokens)
      .innerJoin(memberships, eq(memberships.id, refreshTokens.membershipId))
      .where(
        and(
          eq(memberships.tenantId, id),
          gte(refreshTokens.createdAt, startOfLocalDate(first, BILLING_TIME_ZONE)),
        ),
      )
      .groupBy(sql`1`);
    const byDate = new Map(rows.map((row) => [row.date, row.active]));
    const days = Array.from({ length: 30 }, (_, index) => {
      const date = addDays(first, index);
      return { date, active: byDate.get(date) ?? 0 };
    });
    const [storage] = await this.database.db
      .select({ quantity: usageRecords.quantity })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.tenantId, id),
          eq(usageRecords.period, today.slice(0, 7)),
          eq(usageRecords.metric, 'storage_bytes'),
        ),
      );
    return {
      days,
      activeToday: byDate.get(today) ?? 0,
      storageBytes: storage ? storage.quantity.replace(/\.0+$/, '') : null,
    };
  }

  /** The people a tenant's plan and entitlements allow; null for no limit. */
  private async seatLimit(tenantId: string): Promise<number | null> {
    return (await this.entitlements.forTenant(tenantId)).limits.users ?? null;
  }

  templates(): TemplateSummary[] {
    return TEMPLATE_KEYS.map((key) => {
      const template = loadTemplate(key);
      return {
        key: template.key,
        version: template.version,
        name: template.name,
        description: template.description,
        terms: {
          en: termsLine(resolveTerminology(template.terminology, 'en')),
          hi: termsLine(resolveTerminology(template.terminology, 'hi')),
        },
      };
    });
  }

  async cells(): Promise<CellSummary[]> {
    const rows = await this.database.db
      .select({
        name: cells.name,
        region: cells.region,
        kind: cells.kind,
        status: cells.status,
        capacityUsers: cells.capacityUsers,
        tenants: sql<number>`count(${tenants.id})::int`,
      })
      .from(cells)
      .leftJoin(tenants, eq(tenants.cellId, cells.id))
      .groupBy(cells.id)
      .orderBy(asc(cells.name));
    return rows;
  }

  private async move(
    by: StaffAccess,
    id: string,
    action: string,
    detail: Record<string, unknown>,
    next: (status: TenantStatus, trialEndsAt: Date | null) => TenantStatus,
  ): Promise<ConsoleTenant> {
    await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: tenants.status, trialEndsAt: tenants.trialEndsAt })
        .from(tenants)
        .where(eq(tenants.id, id))
        .for('update');
      if (!row) throw notFound();
      const status = next(row.status, row.trialEndsAt);
      // Already there: the same request again changes nothing.
      if (status === row.status) return;
      await tx.update(tenants).set({ status }).where(eq(tenants.id, id));
      await this.audit.record(tx, by, action, 'tenant', id, {
        ...detail,
        before: row.status,
        after: status,
      });
    });
    return this.get(id);
  }

  private async rows(where: SQL | undefined, limit: number): Promise<ConsoleTenant[]> {
    const rows = await this.database.db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        status: tenants.status,
        templateKey: tenants.templateKey,
        templateVersion: tenants.templateVersion,
        trialEndsAt: tenants.trialEndsAt,
        terminatedAt: tenants.terminatedAt,
        deletedAt: tenants.deletedAt,
        demo: tenants.demo,
        createdAt: tenants.createdAt,
        cellName: cells.name,
        cellRegion: cells.region,
        cellKind: cells.kind,
        planId: plans.id,
        planKey: plans.key,
        planName: plans.name,
        activeUsers: sql<number>`(select count(*)::int from ${memberships} where ${memberships.tenantId} = ${tenants.id} and ${memberships.status} = 'active')`,
        lastActivityAt: sql<
          string | null
        >`(select max(${refreshTokens.createdAt}) from ${refreshTokens} join ${memberships} on ${memberships.id} = ${refreshTokens.membershipId} where ${memberships.tenantId} = ${tenants.id})`,
      })
      .from(tenants)
      .innerJoin(cells, eq(cells.id, tenants.cellId))
      .leftJoin(plans, eq(plans.id, tenants.planId))
      .where(where)
      .orderBy(asc(tenants.slug))
      .limit(limit);
    const limits = await Promise.all(rows.map((row) => this.seatLimit(row.id)));
    return rows.map((row, index) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      cell: { name: row.cellName, region: row.cellRegion, kind: row.cellKind },
      template: { key: row.templateKey, version: row.templateVersion },
      plan:
        row.planId && row.planKey && row.planName
          ? { id: row.planId, key: row.planKey, name: row.planName }
          : null,
      trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
      demo: row.demo,
      activeUsers: row.activeUsers,
      seatLimit: limits[index] ?? null,
      lastActivityAt: row.lastActivityAt ? new Date(row.lastActivityAt).toISOString() : null,
      terminatedAt: row.terminatedAt?.toISOString() ?? null,
      deletesAt:
        row.terminatedAt && !row.deletedAt ? deletionDue(row.terminatedAt).toISOString() : null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

/** A template's words for the people, the plan and its items, as a line. */
function termsLine(terms: ReturnType<typeof resolveTerminology>): string {
  const one = (entry: unknown) =>
    typeof entry === 'string' ? entry : (entry as { one: string }).one;
  return [terms['term.field_user'], terms['term.journey_plan'], terms['term.plan_item']]
    .map(one)
    .join(' · ');
}

/** A search term with LIKE's wildcards taken literally. */
function like(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}
