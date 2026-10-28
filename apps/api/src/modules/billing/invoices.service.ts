import { Injectable } from '@nestjs/common';
import {
  addDays,
  AppError,
  BILLING_TIME_ZONE,
  gstOn,
  type InvoiceKind,
  type InvoiceResult,
  invoiceNumber,
  invoiceSeries,
  newId,
  type RecordPaymentBody,
  scaled,
  sumAmounts,
  todayIn,
  unscaled,
} from '@thelamp/shared';
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  billingAccounts,
  invoices,
  invoiceSequences,
  payments,
  plans,
  subscriptions,
  tenants,
} from '../../db/schema/directory';
import type { StaffAccess } from '../../platform/auth';
import { DirectoryDatabase, type DirectoryTx } from '../directory/directory.database';
import { PlatformAudit } from '../directory/platform-audit';
import { BillingNotices } from './billing-notices';
import { BillingSettings, stateName } from './billing-settings.service';
import { DunningService } from './dunning.service';
import { PaymentGateway } from './gateway';

export interface DraftLine {
  description: string;
  quantity: string;
  rate: string;
  amount: string;
}

type InvoiceRow = typeof invoices.$inferSelect;

const notFound = () => new AppError('NOT_FOUND', 'There is no such invoice.');

/** A stored rate as people write it: 18.0000 is 18, 12.5000 is 12.5. */
export const percent = (rate: string) => (rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate);

/** Paise in a decimal string, for comparing amounts exactly. */
const paise = (amount: string) => scaled(amount, 2);

/**
 * The vendor's GST invoices (module M23, BR-47, decision D90): issued once per period in a gapless
 * series, charged through the gateway when the tenant has a mandate, and paid by the gateway or
 * by payments vendor finance records. Issued invoices never change.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly settings: BillingSettings,
    private readonly gateway: PaymentGateway,
    private readonly dunning: DunningService,
    private readonly notices: BillingNotices,
    private readonly audit: PlatformAudit,
  ) {}

  /**
   * Issues a period's invoice in the caller's transaction, or returns null when it exists
   * already. Its number comes from the series row, locked until the transaction ends, so numbers
   * never skip: a transaction that fails gives its number back.
   */
  async issue(
    tx: DirectoryTx,
    input: {
      tenantId: string;
      subscriptionId: string;
      kind: InvoiceKind;
      period: { from: string; to: string };
      lines: DraftLine[];
      issuedOn: string;
    },
  ): Promise<InvoiceRow | null> {
    const [existing] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.subscriptionId, input.subscriptionId),
          eq(invoices.kind, input.kind),
          eq(invoices.periodFrom, input.period.from),
        ),
      );
    if (existing) return null;
    const settings = await this.settings.forInvoicing();
    const [account] = await tx
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.tenantId, input.tenantId));
    if (!account) {
      throw new AppError('CONFLICT', 'Add the tenant’s billing details before invoicing it.');
    }
    const subtotal = sumAmounts(input.lines.map((line) => line.amount));
    const tax = gstOn(subtotal, settings.gstRate, settings.seller.stateCode, account.stateCode);
    const series = invoiceSeries(settings.invoicePrefix, input.issuedOn);
    const [sequence] = await tx
      .insert(invoiceSequences)
      .values({ series, last: 1 })
      .onConflictDoUpdate({
        target: invoiceSequences.series,
        set: { last: sql`${invoiceSequences.last} + 1` },
      })
      .returning({ last: invoiceSequences.last });
    // Paid automatically on the day it is issued; by transfer within the payment terms.
    const automatic = account.mandateStatus === 'active' && this.gateway.enabled;
    const [row] = await tx
      .insert(invoices)
      .values({
        id: newId(),
        tenantId: input.tenantId,
        subscriptionId: input.subscriptionId,
        number: invoiceNumber(series, sequence!.last),
        kind: input.kind,
        periodFrom: input.period.from,
        periodTo: input.period.to,
        issuedOn: input.issuedOn,
        dueOn: automatic ? input.issuedOn : addDays(input.issuedOn, settings.paymentTermsDays),
        seller: { ...settings.seller, stateName: stateName(settings.seller.stateCode) },
        buyer: {
          legalName: account.legalName,
          gstin: account.gstin,
          address: account.address,
          stateCode: account.stateCode,
          stateName: stateName(account.stateCode),
        },
        lines: input.lines,
        subtotal,
        gstRate: settings.gstRate,
        cgst: tax.cgst,
        sgst: tax.sgst,
        igst: tax.igst,
        total: tax.total,
        example: settings.example,
      })
      .returning();
    await this.audit.record(tx, null, 'invoice.issued', 'tenant', input.tenantId, {
      invoiceId: row!.id,
      number: row!.number,
      total: row!.total,
    });
    return row!;
  }

  /** Tells the tenant an invoice is out; sent after the issuing transaction commits. */
  async announce(row: InvoiceRow): Promise<void> {
    await this.notices.send(row.tenantId, `invoice:${row.id}`, 'invoice_issued', {
      amount: row.total,
      date: row.dueOn,
      number: row.number,
      automatic: row.dueOn === row.issuedOn,
    });
  }

  /**
   * Charges a tenant's unpaid invoices through its mandate, each once: a refusal marks the
   * invoice, which is then overdue (BR-48), and the mandate as failed until it is set up again.
   */
  async chargeDue(tenantId: string, now = new Date()): Promise<void> {
    if (!this.gateway.enabled) return;
    const [account] = await this.database.db
      .select({ status: billingAccounts.mandateStatus, ref: billingAccounts.mandateRef })
      .from(billingAccounts)
      .where(eq(billingAccounts.tenantId, tenantId));
    if (account?.status !== 'active' || !account.ref) return;
    const due = await this.database.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.status, 'issued'),
          isNull(invoices.chargeFailedAt),
          isNull(invoices.providerRef),
        ),
      );
    for (const invoice of due) {
      const owed = await this.owed(invoice.id, invoice.total);
      if (paise(owed) <= 0n) continue;
      const result = await this.gateway.charge({
        mandateRef: account.ref,
        invoiceId: invoice.id,
        number: invoice.number,
        amount: owed,
      });
      await this.database.db.transaction(async (tx) => {
        if (result.ok) {
          await tx.insert(payments).values({
            id: newId(),
            invoiceId: invoice.id,
            tenantId,
            amount: owed,
            method: 'mandate',
            reference: invoice.number,
            receivedOn: todayIn(BILLING_TIME_ZONE, now),
            providerRef: result.providerRef,
          });
          await tx
            .update(invoices)
            .set({ status: 'paid', providerRef: result.providerRef })
            .where(eq(invoices.id, invoice.id));
        } else {
          await tx.update(invoices).set({ chargeFailedAt: now }).where(eq(invoices.id, invoice.id));
          await tx
            .update(billingAccounts)
            .set({ mandateStatus: 'failed', updatedAt: now })
            .where(eq(billingAccounts.tenantId, tenantId));
          await this.audit.record(tx, null, 'invoice.charge_failed', 'tenant', tenantId, {
            invoiceId: invoice.id,
            reason: result.reason,
          });
        }
      });
    }
    await this.dunning.review(tenantId, now);
  }

  /**
   * A payment received outside the gateway, such as a bank transfer. Its ID is the console's, so
   * recording it twice records it once; never more than the invoice still owes.
   */
  async recordPayment(
    by: StaffAccess,
    invoiceId: string,
    body: RecordPaymentBody,
    now = new Date(),
  ): Promise<InvoiceResult> {
    const tenantId = await this.database.db.transaction(async (tx) => {
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .for('update');
      if (!invoice) throw notFound();
      const [same] = await tx.select().from(payments).where(eq(payments.id, body.id));
      if (same) {
        if (same.invoiceId !== invoiceId || paise(same.amount) !== paise(body.amount)) {
          throw new AppError(
            'IDEMPOTENCY_CONFLICT',
            'This payment was recorded with other details.',
          );
        }
        return invoice.tenantId;
      }
      const owed = await this.owed(invoiceId, invoice.total, tx);
      if (paise(body.amount) <= 0n || paise(body.amount) > paise(owed)) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'amount', issue: `Enter an amount up to ${owed}, which is what is owed` },
        ]);
      }
      await tx.insert(payments).values({
        id: body.id,
        invoiceId,
        tenantId: invoice.tenantId,
        amount: body.amount,
        method: body.method,
        reference: body.reference,
        receivedOn: body.receivedOn,
        recordedBy: by.staffId,
      });
      if (paise(body.amount) === paise(owed)) {
        await tx.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, invoiceId));
      }
      await this.audit.record(tx, by, 'invoice.payment_recorded', 'tenant', invoice.tenantId, {
        invoiceId,
        paymentId: body.id,
        amount: body.amount,
        method: body.method,
      });
      return invoice.tenantId;
    });
    await this.dunning.review(tenantId, now);
    return this.get(invoiceId);
  }

  /** What an invoice still owes: its total less what was paid on it. */
  private async owed(invoiceId: string, total: string, tx?: DirectoryTx): Promise<string> {
    const [row] = await (tx ?? this.database.db)
      .select({ paid: sql<string>`coalesce(sum(${payments.amount}), 0)::text` })
      .from(payments)
      .where(eq(payments.invoiceId, invoiceId));
    return unscaled(paise(total) - paise(row?.paid ?? '0'), 2);
  }

  async get(id: string): Promise<InvoiceResult> {
    const [found] = await this.results(eq(invoices.id, id), 1);
    if (!found) throw notFound();
    return found;
  }

  /** Invoices newest first, a page at a time; the cursor is the last one's number. */
  async list(query: {
    tenantId?: string;
    status?: 'issued' | 'paid';
    limit: number;
    cursor?: string;
  }): Promise<{ items: InvoiceResult[]; nextCursor: string | null }> {
    const conditions: SQL[] = [];
    if (query.tenantId) conditions.push(eq(invoices.tenantId, query.tenantId));
    if (query.status) conditions.push(eq(invoices.status, query.status));
    if (query.cursor) {
      const [issuedOn, id] = query.cursor.split('_');
      if (issuedOn && id) {
        conditions.push(
          or(
            lt(invoices.issuedOn, issuedOn),
            and(eq(invoices.issuedOn, issuedOn), lt(invoices.id, id)),
          )!,
        );
      }
    }
    const items = await this.results(
      conditions.length ? and(...conditions) : undefined,
      query.limit + 1,
    );
    const page = items.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor: items.length > query.limit && last ? `${last.issuedOn}_${last.id}` : null,
    };
  }

  /** An invoice's row, for its PDF. */
  async row(id: string): Promise<InvoiceRow> {
    const [row] = await this.database.db.select().from(invoices).where(eq(invoices.id, id));
    if (!row) throw notFound();
    return row;
  }

  private async results(where: SQL | undefined, limit: number): Promise<InvoiceResult[]> {
    const rows = await this.database.db
      .select({
        invoice: invoices,
        tenant: { id: tenants.id, name: tenants.name, slug: tenants.slug },
        plan: { key: plans.key, name: plans.name },
      })
      .from(invoices)
      .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
      .innerJoin(subscriptions, eq(subscriptions.id, invoices.subscriptionId))
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(where)
      .orderBy(desc(invoices.issuedOn), desc(invoices.id))
      .limit(limit);
    const ids = rows.map((row) => row.invoice.id);
    const paid = ids.length
      ? await this.database.db
          .select()
          .from(payments)
          .where(inArray(payments.invoiceId, ids))
          .orderBy(payments.createdAt)
      : [];
    return rows.map(({ invoice, tenant, plan }) => {
      const own = paid.filter((payment) => payment.invoiceId === invoice.id);
      return {
        id: invoice.id,
        number: invoice.number,
        tenant,
        plan,
        kind: invoice.kind,
        period: { from: invoice.periodFrom, to: invoice.periodTo },
        issuedOn: invoice.issuedOn,
        dueOn: invoice.dueOn,
        seller: invoice.seller,
        buyer: invoice.buyer,
        lines: invoice.lines,
        subtotal: invoice.subtotal,
        gstRate: percent(invoice.gstRate),
        cgst: invoice.cgst,
        sgst: invoice.sgst,
        igst: invoice.igst,
        total: invoice.total,
        paid: sumAmounts(own.map((payment) => payment.amount)),
        status: invoice.status,
        example: invoice.example,
        payments: own.map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference,
          receivedOn: payment.receivedOn,
          recordedAt: payment.createdAt.toISOString(),
        })),
      };
    });
  }
}
