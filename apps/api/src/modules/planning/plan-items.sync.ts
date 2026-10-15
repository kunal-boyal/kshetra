import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type SyncPlanItem, todayIn } from '@kshetra/shared';
import { and, asc, eq, gte, lte, or, sql } from 'drizzle-orm';
import { planItems, planMonths } from '../../db/schema/planning';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

const DAY_MS = 86_400_000;

/**
 * The plan items a phone keeps (M8, spec 11.3): the person's own, from yesterday to the end of
 * next month, so today's plan works offline. Where the tenant has months approved, a month's
 * items reach the phone once it is approved; the visits the person added themselves always do.
 * The window moves each day and a month's approval changes what is held, so both are in the
 * scope, and either change sends a fresh copy.
 */
@Injectable()
export class PlanItemsSync implements SyncSource<SyncPlanItem>, OnModuleInit {
  readonly name = 'plan_items';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly settings: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  /** The days the phone keeps, `[from, to]`. */
  private async window(tx: TenantTx, tenantId: string): Promise<[string, string]> {
    const today = todayIn((await this.settings.settings(tx, tenantId)).timezone);
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
    const [year, month] = today.split('-').map(Number) as [number, number];
    const to = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    return [from, to];
  }

  /** The months the person's plan is approved for, or null where months aren't approved. */
  private async approved(tx: TenantTx, access: Access): Promise<string[] | null> {
    const { journeyPlanApproval } = await this.settings.settings(tx, access.tenantId);
    if (!journeyPlanApproval) return null;
    const rows = await tx
      .select({ period: planMonths.period })
      .from(planMonths)
      .where(
        and(
          eq(planMonths.tenantId, access.tenantId),
          eq(planMonths.userId, access.userId),
          eq(planMonths.status, 'approved'),
        ),
      )
      .orderBy(asc(planMonths.period));
    return rows.map((row) => row.period);
  }

  async scope(tx: TenantTx, access: Access): Promise<string> {
    if (!access.permissions.has('visit.use')) return 'none';
    const [from] = await this.window(tx, access.tenantId);
    const approved = await this.approved(tx, access);
    return approved === null ? from : `${from}|${approved.join(',')}`;
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncPlanItem>[]> {
    if (!access.permissions.has('visit.use')) return [];
    const [from, to] = await this.window(tx, access.tenantId);
    const approved = await this.approved(tx, access);
    const found = await tx
      .select({
        version: planItems.rowVersion,
        id: planItems.id,
        accountId: planItems.accountId,
        date: planItems.date,
        purpose: planItems.purpose,
        note: planItems.note,
        status: planItems.status,
        source: planItems.source,
        visitId: planItems.visitId,
      })
      .from(planItems)
      .where(
        and(
          eq(planItems.tenantId, access.tenantId),
          eq(planItems.userId, access.userId),
          gte(planItems.date, from),
          lte(planItems.date, to),
          approved === null
            ? undefined
            : or(
                and(eq(planItems.source, 'adhoc'), eq(planItems.createdBy, access.userId)),
                approved.length > 0
                  ? sql`to_char(${planItems.date}, 'YYYY-MM') in (${sql.join(
                      approved.map((period) => sql`${period}`),
                      sql`, `,
                    )})`
                  : sql`false`,
              ),
          gte(planItems.rowVersion, page.since),
          page.after
            ? sql`(${planItems.rowVersion}, ${planItems.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(planItems.rowVersion), asc(planItems.id))
      .limit(page.limit);
    return found.map(({ version, ...row }) => ({ version, id: row.id, row }));
  }
}
