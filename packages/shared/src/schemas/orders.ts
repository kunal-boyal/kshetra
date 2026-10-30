import { z } from 'zod';
import { MEASURE_TYPES } from '../catalogue';
import { LINE_DECISIONS, ORDER_STATUSES, SUPPLIER_KINDS } from '../orders';
import { ORDER_MAX_LINES } from '../pricing';
import { ApprovalResult } from './approvals';
import { Percent, UnitFactor } from './catalogue';
import { Key, LocalizedText, Money } from './config';
import { CaptureFix } from './field';
import { Period } from './planning';

/**
 * Orders (M10, spec 5.11, decision D78): a request from the field, priced by the server from the
 * price lists that apply when it is placed. Accepting one creates no invoice and moves no stock.
 */

export const OrderStatus = z.enum(ORDER_STATUSES);
export const LineDecision = z.enum(LINE_DECISIONS);

/** A quantity in the chosen unit: more than 0, up to 3 places. */
export const OrderQuantity = z
  .string()
  .regex(/^\d{1,12}(?:\.\d{1,3})?$/, 'Write a quantity such as 2 or 0.5')
  .refine((text) => /[1-9]/.test(text), 'Order more than nothing');

const Person = z.object({ id: z.uuid(), code: z.string(), name: z.string() });
const AccountRef = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

/**
 * `POST /v1/orders`: places an order with the device's own ID (spec 12.2). Each line carries what
 * the device showed, so the server refuses with `PRICE_CHANGED` when the price list now says
 * otherwise (BR-14). A fix is required from a phone and optional from the order desk.
 */
export const PlaceOrderBody = z
  .strictObject({
    id: z.uuid(),
    accountId: z.uuid(),
    visitId: z.uuid().nullable().default(null),
    lines: z
      .array(
        z.strictObject({
          itemId: z.uuid(),
          unitKey: Key,
          quantity: OrderQuantity,
          /** What the device showed for this line. */
          quoted: z.strictObject({
            listId: z.uuid(),
            price: Money,
            discount: Percent,
            taxRate: Percent,
            factor: UnitFactor,
          }),
        }),
      )
      .min(1)
      .max(ORDER_MAX_LINES),
    note: z.string().trim().max(1000).nullable().default(null),
    photos: z.array(z.uuid()).max(5).default([]),
    fix: CaptureFix.nullable().default(null),
    placedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'PlaceOrderBody' });

export const OrderLineResult = z
  .object({
    id: z.uuid(),
    position: z.int().min(1),
    /** The item as it was when the order was placed (BR-15). */
    item: z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      packLabel: z.string().nullable(),
      hsn: z.string().nullable(),
      mrp: z.string().nullable(),
      baseUnit: Key,
    }),
    unitKey: Key,
    quantity: z.string(),
    factor: z.string(),
    baseUnits: z.string(),
    measureType: z.enum(MEASURE_TYPES).nullable(),
    measure: z.string().nullable(),
    priceListId: z.uuid(),
    price: z.string(),
    discount: z.string(),
    taxRate: z.string(),
    rate: z.string(),
    taxable: z.string(),
    tax: z.string(),
    total: z.string(),
    decision: LineDecision,
    decisionReason: Key.nullable(),
    /** Base units fulfilled so far; null until fulfilment starts. */
    fulfilledUnits: z.string().nullable(),
  })
  .meta({ id: 'OrderLine' });

/** One step of an order's life, from the audit log (decision D104). */
export const ORDER_HISTORY_KINDS = [
  'placed',
  /** An approver accepted it at their step, or decided its lines one by one. */
  'approved',
  'lines_decided',
  'rejected',
  'fulfilled',
  'partially_fulfilled',
  'cancelled',
] as const;

export const OrderHistoryEntry = z.object({
  kind: z.enum(ORDER_HISTORY_KINDS),
  at: z.iso.datetime(),
  /** Who did it; null for the system. */
  by: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** For `placed`: it reached the server more than ten minutes after it was placed. */
  offline: z.boolean(),
});

export const OrderResult = z
  .object({
    id: z.uuid(),
    /** The tenant's short number for it, from 1001 (decision D104). */
    number: z.int(),
    account: AccountRef,
    supplier: z.object({ kind: z.enum(SUPPLIER_KINDS), account: AccountRef.nullable() }),
    placedBy: Person,
    visitId: z.uuid().nullable(),
    placedAt: z.iso.datetime({ offset: true }),
    receivedAt: z.iso.datetime(),
    note: z.string().nullable(),
    photos: z.array(z.uuid()),
    status: OrderStatus,
    rejectionReason: Key.nullable(),
    lines: z.array(OrderLineResult),
    totals: z.object({
      taxable: z.string(),
      tax: z.string(),
      total: z.string(),
      /** Within the state, the tax as equal halves (decision D73). */
      cgst: z.string(),
      sgst: z.string(),
    }),
    /** kg and L totalled separately (BR-11). */
    measures: z.partialRecord(z.enum(MEASURE_TYPES), z.string()),
    /** The order's approval, while it waits and after. */
    approval: ApprovalResult.nullable(),
    /** What the caller may do with it now. */
    can: z.object({
      decide: z.boolean(),
      decideLines: z.boolean(),
      fulfil: z.boolean(),
    }),
    /** Moves with each decision and fulfilment, for changes made at the version seen. */
    version: z.int().min(1),
    /** What happened to it, oldest first. */
    history: z.array(OrderHistoryEntry),
  })
  .meta({ id: 'Order' });

export const OrderSummary = z
  .object({
    id: z.uuid(),
    number: z.int(),
    account: AccountRef,
    placedBy: Person,
    placedAt: z.iso.datetime({ offset: true }),
    status: OrderStatus,
    lineCount: z.int().min(1),
    total: z.string(),
  })
  .meta({ id: 'OrderSummary' });

export const OrderListQuery = z.strictObject({
  /** The order's number, as search finds it (D110). */
  number: z.coerce.number().int().positive().optional(),
  status: OrderStatus.optional(),
  accountId: z.uuid().optional(),
  userId: z.uuid().optional(),
  /** A month on the tenant's clock; `from` and `to` win when either is given. */
  period: Period.optional(),
  /** Calendar dates on the tenant's clock, both included. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

/** `GET /v1/orders`: the orders the caller sees, newest first. */
export const OrderListResult = z.object({
  items: z.array(OrderSummary),
  nextCursor: z.uuid().nullable(),
  /**
   * With the first page only (null after), under the filters but status: how many orders each
   * status holds, how many in all, and the value of those not rejected or cancelled.
   */
  summary: z
    .object({
      counts: z.partialRecord(OrderStatus, z.int()),
      orders: z.int(),
      value: z.string(),
    })
    .nullable(),
});

/** `POST /v1/orders/{id}/decision`: accepts or rejects the whole order at its step. */
export const OrderDecisionBody = z
  .strictObject({
    decision: z.enum(['accept', 'reject']),
    /** One of the tenant's rejection reasons, required to reject (BR-19). */
    reason: Key.optional(),
    note: z.string().trim().max(500).optional(),
    /** The approval's version the approver saw. */
    version: z.int().min(1),
  })
  .meta({ id: 'OrderDecisionBody' });

/** `POST /v1/orders/{id}/line-decisions`: decides every line at a step that decides by line. */
export const LineDecisionsBody = z
  .strictObject({
    lines: z
      .array(
        z.strictObject({
          lineId: z.uuid(),
          decision: z.enum(['accepted', 'rejected']),
          reason: Key.optional(),
        }),
      )
      .min(1)
      .max(ORDER_MAX_LINES),
    note: z.string().trim().max(500).optional(),
    version: z.int().min(1),
  })
  .meta({ id: 'LineDecisionsBody' });

/**
 * `POST /v1/orders/{id}/fulfilment` (BR-19): records how many base units of each accepted line
 * went out so far, or cancels an accepted order. At the order's version.
 */
export const FulfilmentBody = z
  .discriminatedUnion('action', [
    z.strictObject({
      action: z.literal('fulfil'),
      lines: z
        .array(
          z.strictObject({
            lineId: z.uuid(),
            fulfilledUnits: z.string().regex(/^\d{1,15}(?:\.\d{1,3})?$/),
          }),
        )
        .min(1)
        .max(ORDER_MAX_LINES),
      version: z.int().min(1),
    }),
    z.strictObject({
      action: z.literal('cancel'),
      note: z.string().trim().min(3).max(500),
      version: z.int().min(1),
    }),
  ])
  .meta({ id: 'FulfilmentBody' });

/** The tenant's reasons for rejecting orders and lines (spec 5.11). */
export const RejectionReason = z.object({ key: Key, name: LocalizedText });

export type PlaceOrderBody = z.output<typeof PlaceOrderBody>;
export type OrderLineResult = z.infer<typeof OrderLineResult>;
export type OrderHistoryEntry = z.infer<typeof OrderHistoryEntry>;
export type OrderResult = z.infer<typeof OrderResult>;
export type OrderSummary = z.infer<typeof OrderSummary>;
export type OrderListQuery = z.output<typeof OrderListQuery>;
export type OrderListResult = z.infer<typeof OrderListResult>;
export type OrderDecisionBody = z.output<typeof OrderDecisionBody>;
export type LineDecisionsBody = z.output<typeof LineDecisionsBody>;
export type FulfilmentBody = z.output<typeof FulfilmentBody>;
export type RejectionReason = z.infer<typeof RejectionReason>;
