import { Injectable } from '@nestjs/common';
import { formatDate } from '@thelamp/i18n';
import {
  addDays,
  annualTerm,
  AppError,
  type BillingAccountBody,
  BILLING_TIME_ZONE,
  lineAmount,
  newId,
  type SubscriptionBody,
  type SubscriptionResult,
  type TenantBillingResult,
  type TenantStatus,
  todayIn,
} from '@thelamp/shared';
import { and, desc, eq } from 'drizzle-orm';
import {
  billingAccounts,
  invoices,
  plans,
  subscriptions,
  tenants,
} from '../../db/schema/directory';
import type { StaffAccess } from '../../platform/auth';
import { DirectoryDatabase } from '../directory/directory.database';
import { PlatformAudit } from '../directory/platform-audit';
import { BillingSettings } from './billing-settings.service';
import { DunningService } from './dunning.service';
import { EntitlementsService } from './entitlements.service';
import { PaymentGateway } from './gateway';
import { InvoicesService } from './invoices.service';

type Subscription = typeof subscriptions.$inferSelect;
type Plan = typeof plans.$inferSelect;

const notFound = () => new AppError('NOT_FOUND', 'There is no such tenant.');

/** A day as invoices print it: 15 Nov 2026. */
export const printed = (day: string) => formatDate(day, { locale: 'en' });

/** The annual invoice's line: the committed seats for the term, at the plan's annual price. */
export function annualLine(plan: Plan, seats: number, term: { from: string; to: string }) {
  return {
    description: `Annual subscription, ${plan.name.en} plan, ${printed(term.from)} to ${printed(term.to)} (per seat)`,
    quantity: `${seats}.0000`,
    rate: plan.priceYear,
    amount: lineAmount(`${seats}`, plan.priceYear),
  };
}

/**
 * A tenant's billing (module M23, decision D90): its details as a buyer, its subscription, its
 * mandate for automatic payment, and where it stands. Starting an annual subscription invoices
 * its term at once; monthly ones are invoiced after each month by the billing job.
 */
@Injectable()
export class TenantBillingService {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly settings: BillingSettings,
    private readonly entitlements: EntitlementsService,
    private readonly invoices: InvoicesService,
    private readonly dunning: DunningService,
    private readonly gateway: PaymentGateway,
    private readonly audit: PlatformAudit,
  ) {}

  async overview(tenantId: string, now = new Date()): Promise<TenantBillingResult> {
    await this.tenant(tenantId);
    const [account] = await this.database.db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.tenantId, tenantId));
    const subscription = await this.current(tenantId);
    const { outstanding } = await this.dunning.standing(tenantId, todayIn(BILLING_TIME_ZONE, now));
    return {
      account: account
        ? {
            legalName: account.legalName,
            gstin: account.gstin,
            address: account.address,
            stateCode: account.stateCode,
            email: account.email,
            language: account.language as 'en' | 'hi',
            mandate: account.mandateStatus,
          }
        : null,
      subscription: subscription ? await this.subscriptionResult(subscription) : null,
      outstanding,
      dunning: await this.dunning.state(tenantId, now),
    };
  }

  async setAccount(by: StaffAccess | null, tenantId: string, body: BillingAccountBody) {
    await this.tenant(tenantId);
    await this.database.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(billingAccounts)
        .where(eq(billingAccounts.tenantId, tenantId));
      const values = { ...body, updatedAt: new Date() };
      await tx
        .insert(billingAccounts)
        .values({ tenantId, ...values })
        .onConflictDoUpdate({ target: billingAccounts.tenantId, set: values });
      await this.audit.record(tx, by, 'billing.account_changed', 'tenant', tenantId, {
        before: before ?? null,
        after: body,
      });
    });
    return this.overview(tenantId);
  }

  /**
   * Sets up automatic payment: the gateway's page for the billing contact, or an active mandate
   * at once where the gateway needs none. Invoices whose charge was refused are tried again.
   */
  async authorise(by: StaffAccess | null, tenantId: string): Promise<{ url: string | null }> {
    const [account] = await this.database.db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.tenantId, tenantId));
    if (!account) throw new AppError('CONFLICT', 'Add the billing details first.');
    if (!this.gateway.enabled) {
      throw new AppError(
        'CONFLICT',
        'Automatic payment is not available yet. Pay invoices by bank transfer.',
      );
    }
    const mandate = await this.gateway.authorise(tenantId, account.email);
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(billingAccounts)
        .set({
          mandateStatus: mandate.url ? 'pending' : 'active',
          mandateRef: mandate.ref,
          updatedAt: new Date(),
        })
        .where(eq(billingAccounts.tenantId, tenantId));
      await tx
        .update(invoices)
        .set({ chargeFailedAt: null })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'issued')));
      await this.audit.record(tx, by, 'billing.mandate_started', 'tenant', tenantId, {
        pending: Boolean(mandate.url),
      });
    });
    await this.invoices.chargeDue(tenantId);
    return { url: mandate.url };
  }

  /**
   * Starts a subscription, or moves a monthly one to another plan from its next invoice. The
   * tenant goes on the plan, opens if it was on trial or suspended, and an annual subscription's
   * term is invoiced at once.
   */
  async subscribe(
    by: StaffAccess,
    tenantId: string,
    body: SubscriptionBody,
    now = new Date(),
  ): Promise<TenantBillingResult> {
    const tenant = await this.tenant(tenantId);
    if (tenant.status === 'terminated') {
      throw new AppError('CONFLICT', 'A terminated tenant can’t subscribe.');
    }
    const [plan] = await this.database.db.select().from(plans).where(eq(plans.id, body.planId));
    if (!plan) throw new AppError('NOT_FOUND', 'There is no such plan.');
    if (!plan.active && plan.id !== tenant.planId) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [
        { path: 'planId', issue: 'This plan is switched off' },
      ]);
    }
    const today = todayIn(BILLING_TIME_ZONE, now);
    const startsOn = body.startsOn ?? today;
    if (startsOn < addDays(today, -31) || startsOn > addDays(today, 31)) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [
        { path: 'startsOn', issue: 'Start within a month of today' },
      ]);
    }
    await this.settings.forInvoicing();
    const [account] = await this.database.db
      .select({ tenantId: billingAccounts.tenantId })
      .from(billingAccounts)
      .where(eq(billingAccounts.tenantId, tenantId));
    if (!account) throw new AppError('CONFLICT', 'Add the tenant’s billing details first.');

    const existing = await this.current(tenantId);
    if (existing && existing.status === 'active' && !existing.endsOn) {
      if (existing.cycle !== 'month' || body.cycle !== 'month') {
        throw new AppError(
          'CONFLICT',
          'An annual subscription changes at its renewal. Cancel it to end it at its term.',
        );
      }
      await this.onPlan(by, tenantId, plan.id);
      await this.database.db.transaction(async (tx) => {
        await tx
          .update(subscriptions)
          .set({ planId: plan.id, updatedAt: now })
          .where(eq(subscriptions.id, existing.id));
        await this.audit.record(tx, by, 'subscription.changed', 'tenant', tenantId, {
          before: existing.planId,
          after: plan.id,
        });
      });
      return this.overview(tenantId, now);
    }
    if (existing && existing.status === 'active') {
      throw new AppError('CONFLICT', 'The current subscription is ending; start again after it.');
    }

    await this.onPlan(by, tenantId, plan.id);
    const term = body.cycle === 'year' ? annualTerm(startsOn) : null;
    const issued = await this.database.db.transaction(async (tx) => {
      const id = newId();
      await tx.insert(subscriptions).values({
        id,
        tenantId,
        planId: plan.id,
        cycle: body.cycle,
        committedSeats: body.cycle === 'year' ? body.committedSeats : null,
        startedOn: startsOn,
        termStart: term?.from ?? null,
        termEnd: term?.to ?? null,
      });
      const [locked] = await tx
        .select({ status: tenants.status })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for('update');
      const opens: TenantStatus[] = ['trial', 'suspended'];
      if (locked && opens.includes(locked.status)) {
        await tx.update(tenants).set({ status: 'active' }).where(eq(tenants.id, tenantId));
      }
      await this.audit.record(tx, by, 'subscription.started', 'tenant', tenantId, {
        subscriptionId: id,
        planId: plan.id,
        cycle: body.cycle,
        committedSeats: body.committedSeats,
        startsOn,
        statusBefore: locked?.status,
      });
      if (!term || body.committedSeats === null) return null;
      return this.invoices.issue(tx, {
        tenantId,
        subscriptionId: id,
        kind: 'annual',
        period: term,
        lines: [annualLine(plan, body.committedSeats, term)],
        issuedOn: today,
      });
    });
    if (issued) {
      await this.invoices.announce(issued);
      await this.invoices.chargeDue(tenantId, now);
    }
    return this.overview(tenantId, now);
  }

  /**
   * Ends a subscription: a monthly one today, invoiced for this month once it ends; an annual one
   * at its term's end. When it has ended and been invoiced, the billing job suspends the tenant.
   */
  async cancel(
    by: StaffAccess,
    tenantId: string,
    reason: string,
    now = new Date(),
  ): Promise<TenantBillingResult> {
    const existing = await this.current(tenantId);
    if (!existing || existing.status !== 'active') {
      throw new AppError('CONFLICT', 'The tenant has no subscription to cancel.');
    }
    if (!existing.endsOn) {
      const endsOn =
        existing.cycle === 'year' ? existing.termEnd! : todayIn(BILLING_TIME_ZONE, now);
      await this.database.db.transaction(async (tx) => {
        await tx
          .update(subscriptions)
          .set({ endsOn, updatedAt: now })
          .where(eq(subscriptions.id, existing.id));
        await this.audit.record(tx, by, 'subscription.cancelled', 'tenant', tenantId, {
          subscriptionId: existing.id,
          endsOn,
          reason,
        });
      });
    }
    return this.overview(tenantId, now);
  }

  /** The tenant's latest subscription, ended or not. */
  async current(tenantId: string): Promise<Subscription | undefined> {
    const [row] = await this.database.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    return row;
  }

  async subscriptionResult(row: Subscription): Promise<SubscriptionResult> {
    const [plan] = await this.database.db.select().from(plans).where(eq(plans.id, row.planId));
    return {
      id: row.id,
      plan: { id: plan!.id, key: plan!.key, name: plan!.name },
      cycle: row.cycle,
      committedSeats: row.committedSeats,
      status: row.status,
      startedOn: row.startedOn,
      term: row.termStart && row.termEnd ? { from: row.termStart, to: row.termEnd } : null,
      endsOn: row.endsOn,
    };
  }

  /** Puts the tenant on the plan, keeping what was added for it alone. */
  private async onPlan(by: StaffAccess, tenantId: string, planId: string): Promise<void> {
    const now = await this.entitlements.detail(tenantId);
    if (now.plan?.id === planId) return;
    await this.entitlements.set(by, tenantId, {
      planId,
      extraModules: now.extraModules,
      limits: now.ownLimits,
    });
  }

  private async tenant(tenantId: string) {
    const [tenant] = await this.database.db
      .select({ status: tenants.status, planId: tenants.planId })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) throw notFound();
    return tenant;
  }
}
