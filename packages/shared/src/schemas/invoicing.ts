import { z } from 'zod';
import { EmailAddress } from '../phone';
import {
  BILLING_CYCLES,
  GST_STATES,
  gstinIssue,
  INVOICE_KINDS,
  INVOICE_STATUSES,
} from '../invoicing';
import { MODULE_KEYS } from '../modules';
import { TenantUsageResult } from './billing';
import { Key, LocalizedText, Money } from './config';

/**
 * Subscriptions, invoices and payments in the platform console (module M23, decision D90). The
 * seller is the vendor; the buyer is a tenant. Amounts are decimal strings in rupees.
 */

const StateCode = z
  .string()
  .refine((code) => GST_STATES[code] !== undefined, 'Choose a state')
  .meta({ id: 'GstStateCode' });

const Gstin = z.string().trim().toUpperCase();

/** Who issues the invoices, their GST details, and how unpaid tenants are followed up (BR-48). */
export const BillingSettingsBody = z
  .strictObject({
    seller: z.strictObject({
      legalName: z.string().trim().min(2).max(160),
      gstin: Gstin.nullable(),
      address: z.string().trim().min(5).max(400),
      stateCode: StateCode,
      email: EmailAddress,
      /** The services accounting code printed on each line; the vendor's CA confirms it. */
      sac: z.string().regex(/^\d{6}$/, 'Enter the 6-digit SAC code'),
    }),
    /** Up to 4 capital letters, so a number fits GST's 16 characters: `TL/26-27/00042`. */
    invoicePrefix: z.string().regex(/^[A-Z]{1,4}$/, 'Use 1 to 4 capital letters'),
    gstRate: Money,
    /** Days an invoice paid by transfer has before it is overdue. */
    paymentTermsDays: z.int().min(0).max(90),
    graceDays: z.int().min(1).max(60),
    readOnlyDays: z.int().min(1).max(90),
  })
  .superRefine((body, ctx) => {
    if (body.seller.gstin === null) return;
    const issue = gstinIssue(body.seller.gstin, body.seller.stateCode);
    if (issue) ctx.addIssue({ code: 'custom', path: ['seller', 'gstin'], message: issue });
  })
  .meta({ id: 'BillingSettingsBody' });

export const BillingSettingsResult = z
  .object({
    seller: z.object({
      legalName: z.string(),
      gstin: z.string().nullable(),
      address: z.string(),
      stateCode: z.string(),
      email: z.string(),
      sac: z.string(),
    }),
    invoicePrefix: z.string(),
    gstRate: z.string(),
    paymentTermsDays: z.int(),
    graceDays: z.int(),
    readOnlyDays: z.int(),
    /** Fictional details, for local, test and demo invoices; production refuses to invoice on them. */
    example: z.boolean(),
    /** Whether invoices can be issued with these details now. */
    ready: z.boolean(),
  })
  .meta({ id: 'BillingSettings' });

/** The tenant as the buyer on its invoices; the state is the place of supply (BR-47). */
export const BillingAccountBody = z
  .strictObject({
    legalName: z.string().trim().min(2).max(160),
    gstin: Gstin.nullable().default(null),
    address: z.string().trim().min(5).max(400),
    stateCode: StateCode,
    email: EmailAddress,
    language: z.enum(['en', 'hi']).default('en'),
  })
  .superRefine((body, ctx) => {
    if (body.gstin === null) return;
    const issue = gstinIssue(body.gstin, body.stateCode);
    if (issue) ctx.addIssue({ code: 'custom', path: ['gstin'], message: issue });
  })
  .meta({ id: 'BillingAccountBody' });

export const MANDATE_STATUSES = ['none', 'pending', 'active', 'failed'] as const;

export const BillingAccountResult = z
  .object({
    legalName: z.string(),
    gstin: z.string().nullable(),
    address: z.string(),
    stateCode: z.string(),
    email: z.string(),
    language: z.enum(['en', 'hi']),
    /** Automatic payment: none until set up, then active, or failed when a charge was refused. */
    mandate: z.enum(MANDATE_STATUSES),
  })
  .meta({ id: 'BillingAccount' });

/**
 * `PUT /platform/v1/tenants/{id}/subscription`: start or change a tenant's subscription. Annual
 * subscriptions commit to seats for the term; monthly ones pay for the seats each month used.
 */
export const SubscriptionBody = z
  .strictObject({
    planId: z.uuid(),
    cycle: z.enum(BILLING_CYCLES),
    /** Seats paid for upfront on an annual subscription. */
    committedSeats: z.int().min(1).max(1_000_000).nullable().default(null),
    /** The first day billed, on the vendor's clock; today when left out. */
    startsOn: z.iso.date().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.cycle === 'year' && body.committedSeats === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['committedSeats'],
        message: 'An annual subscription commits to a number of seats',
      });
    }
  })
  .meta({ id: 'SubscriptionBody' });

export const SubscriptionResult = z
  .object({
    id: z.uuid(),
    plan: z.object({ id: z.uuid(), key: Key, name: LocalizedText }),
    cycle: z.enum(BILLING_CYCLES),
    committedSeats: z.int().nullable(),
    status: z.enum(['active', 'cancelled']),
    startedOn: z.iso.date(),
    /** The current annual term; null on a monthly subscription. */
    term: z.object({ from: z.iso.date(), to: z.iso.date() }).nullable(),
    /** The last day billed, once cancelled. */
    endsOn: z.iso.date().nullable(),
  })
  .meta({ id: 'Subscription' });

/** Ending a subscription: monthly ones at the day given, annual ones at their term's end. */
export const CancelSubscriptionBody = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

/** Where an unpaid tenant stands (BR-48); null when nothing is overdue. */
export const DunningResult = z
  .object({
    overdueSince: z.iso.date(),
    stage: z.enum(['grace', 'read_only', 'suspended']),
    readOnlyOn: z.iso.date(),
    suspendOn: z.iso.date(),
    outstanding: z.string(),
  })
  .meta({ id: 'Dunning' });

export const TenantBillingResult = z
  .object({
    account: BillingAccountResult.nullable(),
    subscription: SubscriptionResult.nullable(),
    /** Unpaid invoices' totals, less what was paid on them. */
    outstanding: z.string(),
    dunning: DunningResult.nullable(),
  })
  .meta({ id: 'TenantBilling' });

const Party = z.object({
  legalName: z.string(),
  gstin: z.string().nullable(),
  address: z.string(),
  stateCode: z.string(),
  stateName: z.string(),
});

export const PAYMENT_METHODS = ['mandate', 'bank_transfer', 'cheque', 'upi', 'other'] as const;

export const PaymentResult = z.object({
  id: z.uuid(),
  amount: z.string(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().nullable(),
  receivedOn: z.iso.date(),
  recordedAt: z.iso.datetime(),
});

export const InvoiceResult = z
  .object({
    id: z.uuid(),
    number: z.string(),
    tenant: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
    /** The plan of the subscription it bills. */
    plan: z.object({ key: Key, name: LocalizedText }),
    kind: z.enum(INVOICE_KINDS),
    period: z.object({ from: z.iso.date(), to: z.iso.date() }),
    issuedOn: z.iso.date(),
    dueOn: z.iso.date(),
    seller: Party.extend({ email: z.string(), sac: z.string() }),
    buyer: Party,
    lines: z.array(
      z.object({
        description: z.string(),
        quantity: z.string(),
        rate: z.string(),
        amount: z.string(),
      }),
    ),
    subtotal: z.string(),
    /** The GST rate it was issued at, in percent. */
    gstRate: z.string(),
    cgst: z.string(),
    sgst: z.string(),
    igst: z.string(),
    total: z.string(),
    paid: z.string(),
    status: z.enum(INVOICE_STATUSES),
    /** Issued on fictional seller details: not a tax invoice. */
    example: z.boolean(),
    payments: z.array(PaymentResult),
  })
  .meta({ id: 'Invoice' });

/** Where the billing contact authorises automatic payment; none when it is already active. */
export const MandateResult = z.object({ url: z.url().nullable() }).meta({ id: 'Mandate' });

export const InvoiceListQuery = z.strictObject({
  tenantId: z.uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

export const InvoiceListResult = z.object({
  items: z.array(InvoiceResult),
  nextCursor: z.string().nullable(),
});

export const InvoiceIdParams = z.strictObject({ id: z.uuid() });

/** A payment received outside the gateway, such as a bank transfer; its ID is the console's. */
export const RecordPaymentBody = z
  .strictObject({
    id: z.uuid(),
    amount: Money,
    method: z.enum(PAYMENT_METHODS).exclude(['mandate']),
    reference: z.string().trim().min(1).max(120).nullable().default(null),
    receivedOn: z.iso.date(),
  })
  .meta({ id: 'RecordPaymentBody' });

/**
 * `GET /v1/billing`: what a tenant admin sees of their organisation's billing (spec M23): the
 * plan and its prices, the people active against its limit, the modules open, the billing
 * details, subscription and automatic payment, where it stands if unpaid, and recent usage.
 */
export const PortalBillingResult = TenantBillingResult.extend({
  plan: z.object({ name: LocalizedText, priceMonth: z.string(), priceYear: z.string() }).nullable(),
  modules: z.array(z.enum(MODULE_KEYS)),
  people: z.object({ active: z.int().min(0), limit: z.int().nullable() }),
  /** When the trial ends, for an organisation on one. */
  trialEndsAt: z.iso.datetime().nullable(),
  /** Whether automatic payment can be set up yet (a payment gateway exists). */
  automaticPayment: z.boolean(),
  usage: TenantUsageResult.shape.items,
}).meta({ id: 'PortalBilling' });

/** The organisation's own invoices, newest first. */
export const PortalInvoiceQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

export type BillingSettingsBody = z.output<typeof BillingSettingsBody>;
export type BillingSettingsResult = z.infer<typeof BillingSettingsResult>;
export type BillingAccountBody = z.output<typeof BillingAccountBody>;
export type BillingAccountResult = z.infer<typeof BillingAccountResult>;
export type SubscriptionBody = z.output<typeof SubscriptionBody>;
export type SubscriptionResult = z.infer<typeof SubscriptionResult>;
export type TenantBillingResult = z.infer<typeof TenantBillingResult>;
export type InvoiceResult = z.infer<typeof InvoiceResult>;
export type RecordPaymentBody = z.output<typeof RecordPaymentBody>;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type MandateStatus = (typeof MANDATE_STATUSES)[number];
export type PortalBillingResult = z.infer<typeof PortalBillingResult>;
