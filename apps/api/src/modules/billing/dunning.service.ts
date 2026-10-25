import { Injectable } from '@nestjs/common';
import {
  addDays,
  BILLING_TIME_ZONE,
  daysBetween,
  dunning,
  type DunningNotice,
  dunningNotices,
  type DunningResult,
  type DunningStatus,
  scaled,
  type TenantStatus,
  todayIn,
  unscaled,
} from '@thelamp/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { invoices, payments, subscriptions, tenants } from '../../db/schema/directory';
import { DirectoryDatabase } from '../directory/directory.database';
import { PlatformAudit } from '../directory/platform-audit';
import { BillingNotices } from './billing-notices';
import { BillingSettings } from './billing-settings.service';

/** The statuses billing moves a tenant between; it never touches trials or terminated tenants. */
const BILLED: readonly TenantStatus[] = ['active', 'grace', 'read_only'];

/**
 * Following up an unpaid tenant (module M23, BR-48, decision D90). A tenant is overdue from the
 * day a charge was refused, or the day after an invoice fell due unpaid. It moves to grace, read
 * only and suspended as the days pass, and back to active once paid; a suspended tenant opens
 * again only when the console reactivates it. The tenant moves only when its stage changes, so a
 * tenant the console reactivated stays open while finance sorts out the payment.
 */
@Injectable()
export class DunningService {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly settings: BillingSettings,
    private readonly notices: BillingNotices,
    private readonly audit: PlatformAudit,
  ) {}

  /**
   * What a tenant's unpaid invoices still owe, and of that what is overdue and since when (the
   * earliest day any fell overdue; null when none has).
   */
  async standing(
    tenantId: string,
    today: string,
  ): Promise<{ since: string | null; overdue: string; outstanding: string }> {
    const unpaid = await this.database.db
      .select({
        total: invoices.total,
        dueOn: invoices.dueOn,
        chargeFailedAt: invoices.chargeFailedAt,
        paid: sql<string>`coalesce(sum(${payments.amount}), 0)::text`,
      })
      .from(invoices)
      .leftJoin(payments, eq(payments.invoiceId, invoices.id))
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'issued')))
      .groupBy(invoices.id);
    let since: string | null = null;
    let amount = 0n;
    let outstanding = 0n;
    for (const invoice of unpaid) {
      const owed = scaled(invoice.total, 2) - scaled(invoice.paid, 2);
      if (owed <= 0n) continue;
      outstanding += owed;
      const from = invoice.chargeFailedAt
        ? todayIn(BILLING_TIME_ZONE, invoice.chargeFailedAt)
        : invoice.dueOn < today
          ? addDays(invoice.dueOn, 1)
          : null;
      if (from === null) continue;
      amount += owed;
      if (since === null || from < since) since = from;
    }
    return { since, overdue: unscaled(amount, 2), outstanding: unscaled(outstanding, 2) };
  }

  /** Where a tenant stands, for the console and the billing page. */
  async state(tenantId: string, now = new Date()): Promise<z.infer<typeof DunningResult> | null> {
    const today = todayIn(BILLING_TIME_ZONE, now);
    const { since, overdue } = await this.standing(tenantId, today);
    if (since === null) return null;
    const { graceDays, readOnlyDays } = await this.settings.read();
    const where = dunning({ overdueSince: since, today, graceDays, readOnlyDays });
    return {
      overdueSince: since,
      stage: where.status,
      readOnlyOn: where.readOnlyOn,
      suspendOn: where.suspendOn,
      outstanding: overdue,
    };
  }

  /** Moves a tenant to where its payments put it, and sends the notice now due. */
  async review(tenantId: string, now = new Date()): Promise<void> {
    const today = todayIn(BILLING_TIME_ZONE, now);
    const [subscription] = await this.database.db
      .select({ id: subscriptions.id, stage: subscriptions.dunningStage })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    if (!subscription) return;
    const { since, overdue } = await this.standing(tenantId, today);
    const { graceDays, readOnlyDays } = await this.settings.read();
    const where = since ? dunning({ overdueSince: since, today, graceDays, readOnlyDays }) : null;
    const stage: DunningStatus | null = where?.status ?? null;

    if (stage !== subscription.stage) {
      await this.database.db.transaction(async (tx) => {
        await tx
          .update(subscriptions)
          .set({ dunningStage: stage, updatedAt: now })
          .where(eq(subscriptions.id, subscription.id));
        const [tenant] = await tx
          .select({ status: tenants.status })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .for('update');
        if (!tenant || !BILLED.includes(tenant.status)) return;
        const next: TenantStatus = stage ?? 'active';
        if (next === tenant.status) return;
        await tx.update(tenants).set({ status: next }).where(eq(tenants.id, tenantId));
        await this.audit.record(tx, null, 'tenant.billing_status', 'tenant', tenantId, {
          before: tenant.status,
          after: next,
          overdueSince: since,
        });
      });
    }

    if (!since || !where) return;
    // Only the latest notice due goes out; earlier ones it supersedes are marked as sent.
    const due = dunningNotices(graceDays, readOnlyDays).filter(
      (notice) => notice.day <= daysBetween(since, today),
    );
    const latest = due.at(-1);
    if (!latest) return;
    const key = (name: string) => `dunning:${since}:${name}`;
    if (await this.notices.sent(tenantId, key(latest.key))) return;
    await this.notices.skip(
      tenantId,
      due.slice(0, -1).map((notice) => key(notice.key)),
    );
    const dateOf: Record<DunningNotice, string | undefined> = {
      payment_overdue: where.readOnlyOn,
      payment_reminder: where.readOnlyOn,
      read_only: where.suspendOn,
      suspension_soon: where.suspendOn,
      suspended: undefined,
    };
    const date = dateOf[latest.notice];
    await this.notices.send(tenantId, key(latest.key), latest.notice, {
      amount: overdue,
      ...(date ? { date } : {}),
    });
  }
}
