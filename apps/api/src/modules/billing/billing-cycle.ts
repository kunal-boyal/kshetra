import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { formatMonth } from '@thelamp/i18n';
import {
  addDays,
  addMonths,
  annualTerm,
  BILLING_TIME_ZONE,
  daysBetween,
  lineAmount,
  periodDays,
  SEAT_SETTLE_DAYS,
  termQuarters,
  TRIAL_REMINDER_DAYS,
  trueUp,
  todayIn,
  type TenantStatus,
} from '@thelamp/shared';
import { and, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { invoices, plans, subscriptions, tenants } from '../../db/schema/directory';
import { SeatCounts } from '../../platform/planes';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { DirectoryDatabase } from '../directory/directory.database';
import { PlatformAudit } from '../directory/platform-audit';
import { BillingNotices } from './billing-notices';
import { DunningService } from './dunning.service';
import { InvoicesService } from './invoices.service';
import { annualLine, printed } from './tenant-billing.service';

/** How often the billing job looks; each run does only what has fallen due since. */
export const BILLING_EVERY_MS = 60 * 60_000;

type Subscription = typeof subscriptions.$inferSelect;
type Plan = typeof plans.$inferSelect;

const BILLED: readonly TenantStatus[] = ['active', 'grace', 'read_only'];

/**
 * The billing job (module M23, BR-47, BR-48, decision D90), every hour on the vendor's clock:
 * each monthly subscription's month is invoiced in arrears once its seats have settled; each
 * annual one renews at its term's end and trues up each quarter; mandates are charged; unpaid
 * tenants move through dunning; ended subscriptions close; and trials end. Every step checks what
 * was done before, so running it again does nothing twice.
 */
@Injectable()
export class BillingCycle implements OnModuleInit {
  private readonly logger = new Logger(BillingCycle.name);

  constructor(
    private readonly database: DirectoryDatabase,
    private readonly invoices: InvoicesService,
    private readonly dunning: DunningService,
    private readonly notices: BillingNotices,
    private readonly seats: SeatCounts,
    private readonly audit: PlatformAudit,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
  ) {}

  onModuleInit(): void {
    this.schedules.every({
      id: 'billing.cycle',
      everyMs: BILLING_EVERY_MS,
      queue: 'maintenance',
      kind: 'billing.cycle',
    });
    this.queues.handle('maintenance', 'billing.cycle', () => this.run());
  }

  /**
   * One run, as of `now`. `only` limits it to some tenants, as tests do, so a run at a later date
   * leaves everyone else alone.
   */
  async run(now = new Date(), only?: readonly string[]): Promise<void> {
    const today = todayIn(BILLING_TIME_ZONE, now);
    const among = (column: AnyPgColumn) => (only ? inArray(column, [...only]) : undefined);
    const active = await this.database.db
      .select({ subscription: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(eq(subscriptions.status, 'active'), among(subscriptions.tenantId)));
    for (const { subscription, plan } of active) {
      try {
        if (subscription.cycle === 'month') await this.monthly(subscription, plan, today);
        else await this.annual(subscription, plan, today);
        await this.invoices.chargeDue(subscription.tenantId, now);
        await this.close(subscription, today);
      } catch (error) {
        // One tenant's trouble, such as billing settings not ready, never stops the others.
        this.logger.error(`Billing tenant ${subscription.tenantId}: ${(error as Error).message}`);
      }
    }
    // Everyone owing anything, ended subscriptions included, is followed up.
    const owing = await this.database.db
      .selectDistinct({ tenantId: invoices.tenantId })
      .from(invoices)
      .where(and(eq(invoices.status, 'issued'), among(invoices.tenantId)));
    const reviewed = new Set([...active.map((row) => row.subscription.tenantId)]);
    for (const { tenantId } of owing) reviewed.add(tenantId);
    for (const tenantId of reviewed) await this.dunning.review(tenantId, now);
    await this.trials(now, today, among(tenants.id));
  }

  /** Every settled month since the subscription began, billed for the seats it used (BR-45). */
  private async monthly(subscription: Subscription, plan: Plan, today: string): Promise<void> {
    // A month is billed from the 4th of the next, once metering has settled it.
    const settled = addDays(today, -SEAT_SETTLE_DAYS);
    const last = addDays(`${settled.slice(0, 7)}-01`, -1).slice(0, 7);
    const done = new Set(
      (
        await this.database.db
          .select({ from: invoices.periodFrom })
          .from(invoices)
          .where(and(eq(invoices.subscriptionId, subscription.id), eq(invoices.kind, 'monthly')))
      ).map((row) => row.from),
    );
    for (
      let month = subscription.startedOn.slice(0, 7);
      month <= last;
      month = addMonths(`${month}-01`, 1).slice(0, 7)
    ) {
      const { start, end } = periodDays(month);
      if (subscription.endsOn && start > subscription.endsOn) break;
      const from = subscription.startedOn > start ? subscription.startedOn : start;
      const to = subscription.endsOn && subscription.endsOn < end ? subscription.endsOn : end;
      if (done.has(from)) continue;
      const seats = await this.seats.billable(
        subscription.tenantId,
        start,
        end,
        true,
        subscription.startedOn,
      );
      if (seats.units === '0.0000') continue;
      const issued = await this.database.db.transaction((tx) =>
        this.invoices.issue(tx, {
          tenantId: subscription.tenantId,
          subscriptionId: subscription.id,
          kind: 'monthly',
          period: { from, to },
          lines: [
            {
              description: `Seats on the ${plan.name.en} plan, ${formatMonth(month, { locale: 'en' })} (per seat per month, prorated by day)`,
              quantity: seats.units,
              rate: plan.priceMonth,
              amount: lineAmount(seats.units, plan.priceMonth),
            },
          ],
          issuedOn: today,
        }),
      );
      if (issued) await this.invoices.announce(issued);
    }
  }

  /** Renews an annual term that has ended, and trues up each settled quarter (BR-47). */
  private async annual(subscription: Subscription, plan: Plan, today: string): Promise<void> {
    let current = subscription;
    if (
      current.termEnd &&
      today > current.termEnd &&
      (!current.endsOn || current.endsOn > current.termEnd)
    ) {
      const term = annualTerm(addDays(current.termEnd, 1));
      const issued = await this.database.db.transaction(async (tx) => {
        const [renewed] = await tx
          .update(subscriptions)
          .set({ termStart: term.from, termEnd: term.to, updatedAt: new Date() })
          .where(and(eq(subscriptions.id, current.id), eq(subscriptions.termEnd, current.termEnd!)))
          .returning();
        if (!renewed) return null;
        current = renewed;
        return this.invoices.issue(tx, {
          tenantId: current.tenantId,
          subscriptionId: current.id,
          kind: 'annual',
          period: term,
          lines: [annualLine(plan, current.committedSeats ?? 0, term)],
          issuedOn: today,
        });
      });
      if (issued) await this.invoices.announce(issued);
    }
    if (!current.termStart) return;
    // This term's quarters, and the last term's final one, which settles after the renewal.
    const terms = [current.termStart];
    const previous = addMonths(current.termStart, -12);
    if (previous >= current.startedOn) terms.unshift(previous);
    for (const termStart of terms) {
      for (const quarter of termQuarters(termStart)) {
        if (today <= addDays(quarter.to, SEAT_SETTLE_DAYS)) continue;
        await this.trueUpQuarter(current.id, plan, quarter, today);
      }
    }
  }

  private async trueUpQuarter(
    subscriptionId: string,
    plan: Plan,
    quarter: { quarter: number; from: string; to: string },
    today: string,
  ): Promise<void> {
    const [done] = await this.database.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.subscriptionId, subscriptionId),
          eq(invoices.kind, 'true_up'),
          eq(invoices.periodFrom, quarter.from),
        ),
      );
    if (done) return;
    const [subscription] = await this.database.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId));
    if (!subscription) return;
    const seats = await this.seats.billable(subscription.tenantId, quarter.from, quarter.to, false);
    const committed = subscription.committedSeats ?? 0;
    const due = trueUp({
      committed,
      seats: seats.seats,
      priceYear: plan.priceYear,
      quarter: quarter.quarter,
    });
    if (due.extra === 0) return;
    const termEnd = addDays(addMonths(quarter.from, due.months), -1);
    const issued = await this.database.db.transaction(async (tx) => {
      const [raised] = await tx
        .update(subscriptions)
        .set({ committedSeats: committed + due.extra, updatedAt: new Date() })
        .where(
          and(eq(subscriptions.id, subscriptionId), eq(subscriptions.committedSeats, committed)),
        )
        .returning({ id: subscriptions.id });
      if (!raised) return null;
      return this.invoices.issue(tx, {
        tenantId: subscription.tenantId,
        subscriptionId,
        kind: 'true_up',
        period: { from: quarter.from, to: termEnd },
        lines: [
          {
            description: `Seats above the commitment in quarter ${quarter.quarter} (${printed(quarter.from)} to ${printed(quarter.to)}), ${plan.name.en} plan, for ${due.months} months to ${printed(termEnd)} (per seat)`,
            quantity: `${due.extra}.0000`,
            rate: due.rate,
            amount: due.amount,
          },
        ],
        issuedOn: today,
      });
    });
    if (issued) await this.invoices.announce(issued);
  }

  /**
   * Closes a subscription past its last day once its last invoice is out, and suspends the
   * tenant: nothing pays for it any more.
   */
  private async close(subscription: Subscription, today: string): Promise<void> {
    if (!subscription.endsOn || today <= addDays(subscription.endsOn, SEAT_SETTLE_DAYS)) return;
    await this.database.db.transaction(async (tx) => {
      const [closed] = await tx
        .update(subscriptions)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.status, 'active')))
        .returning({ id: subscriptions.id });
      if (!closed) return;
      const [tenant] = await tx
        .select({ status: tenants.status })
        .from(tenants)
        .where(eq(tenants.id, subscription.tenantId))
        .for('update');
      if (tenant && BILLED.includes(tenant.status)) {
        await tx
          .update(tenants)
          .set({ status: 'suspended' })
          .where(eq(tenants.id, subscription.tenantId));
      }
      await this.audit.record(tx, null, 'subscription.ended', 'tenant', subscription.tenantId, {
        subscriptionId: subscription.id,
        endsOn: subscription.endsOn,
        statusBefore: tenant?.status,
      });
    });
  }

  /**
   * Trials (spec 10.3): reminders 7 days and 1 day before the end, then suspension for a trial
   * that ended without a subscription. Demo tenants never end.
   */
  private async trials(now: Date, today: string, among: SQL | undefined): Promise<void> {
    const trials = await this.database.db
      .select({ id: tenants.id, endsAt: tenants.trialEndsAt })
      .from(tenants)
      .where(
        and(
          eq(tenants.status, 'trial'),
          eq(tenants.demo, false),
          isNotNull(tenants.trialEndsAt),
          among,
          sql`not exists (select 1 from ${subscriptions} where ${subscriptions.tenantId} = ${tenants.id} and ${subscriptions.status} = 'active')`,
        ),
      );
    for (const trial of trials) {
      const endsOn = todayIn(BILLING_TIME_ZONE, trial.endsAt!);
      if (now >= trial.endsAt!) {
        await this.database.db.transaction(async (tx) => {
          const [ended] = await tx
            .update(tenants)
            .set({ status: 'suspended' })
            .where(and(eq(tenants.id, trial.id), eq(tenants.status, 'trial')))
            .returning({ id: tenants.id });
          if (!ended) return;
          await this.audit.record(tx, null, 'tenant.trial_ended', 'tenant', trial.id, {
            before: 'trial',
            after: 'suspended',
          });
        });
        await this.notices.send(trial.id, `trial:${endsOn}:ended`, 'trial_ended', {
          date: endsOn,
        });
        continue;
      }
      const left = daysBetween(today, endsOn);
      const due = TRIAL_REMINDER_DAYS.filter((days) => left <= days);
      const latest = due.at(-1);
      if (latest === undefined) continue;
      const key = (days: number) => `trial:${endsOn}:${days}`;
      if (await this.notices.sent(trial.id, key(latest))) continue;
      await this.notices.skip(trial.id, due.slice(0, -1).map(key));
      await this.notices.send(trial.id, key(latest), 'trial_reminder', { date: endsOn });
    }
  }
}
