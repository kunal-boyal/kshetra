import { z } from 'zod';
import { COUNT_FLAGS, RECORDED_MOVEMENT_KINDS, STOCK_MOVEMENT_KINDS } from '../stock';
import { StockQuantity } from './sell-through';

/**
 * Distributors' stock (module M24, BR-62, decision D130): levels per account and item, the
 * movements a kept ledger is made of, and counts. Quantities are base units.
 */

/** A signed quantity of base units, for a correction: up to 3 places. */
export const SignedStockQuantity = z
  .string()
  .regex(/^-?\d{1,12}(?:\.\d{1,3})?$/, 'Write a quantity such as 12, -3 or 0.5');

const ItemRef = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  baseUnit: z.string(),
});
const PersonRef = z.object({ id: z.uuid(), name: z.string() });

const uniqueItems = <T extends { itemId: string }>(lines: readonly T[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    if (seen.has(line.itemId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['lines', index, 'itemId'],
        message: 'Name each item once',
      });
    }
    seen.add(line.itemId);
  });
};

/**
 * `POST /v1/stock/movements`: goods in or out of an account by hand, with the client's ID. A
 * correction's quantity carries its own sign; every other kind's is how many moved.
 */
export const RecordStockBody = z
  .strictObject({
    id: z.uuid(),
    accountId: z.uuid(),
    kind: z.enum(RECORDED_MOVEMENT_KINDS),
    occurredOn: z.iso.date().optional(),
    note: z.string().trim().max(500).optional(),
    lines: z
      .array(z.strictObject({ itemId: z.uuid(), quantity: SignedStockQuantity }))
      .min(1)
      .max(500),
  })
  .superRefine((body, ctx) => {
    uniqueItems(body.lines, ctx);
    if (body.kind !== 'corrected') {
      body.lines.forEach((line, index) => {
        if (line.quantity.startsWith('-')) {
          ctx.addIssue({
            code: 'custom',
            path: ['lines', index, 'quantity'],
            message: 'Write how many moved; only a correction is negative',
          });
        }
      });
    }
  })
  .meta({ id: 'RecordStockBody' });
export type RecordStockBody = z.infer<typeof RecordStockBody>;

/** `POST /v1/stock/counts`: what a person counted at an account, with the client's ID. */
export const StockCountBody = z
  .strictObject({
    id: z.uuid(),
    accountId: z.uuid(),
    countedAt: z.iso.datetime().optional(),
    note: z.string().trim().max(500).optional(),
    lines: z
      .array(z.strictObject({ itemId: z.uuid(), counted: StockQuantity }))
      .min(1)
      .max(500),
  })
  .superRefine((body, ctx) => uniqueItems(body.lines, ctx))
  .meta({ id: 'StockCountBody' });
export type StockCountBody = z.infer<typeof StockCountBody>;

export const StockLevel = z.object({
  item: ItemRef,
  onHand: z.string(),
  /** On hand at the account's own price before tax; null without a price. */
  value: z.string().nullable(),
  /** When stock last moved here, was last counted, or (books) the day of the level loaded. */
  movedAt: z.iso.datetime().nullable(),
  countedOn: z.iso.date().nullable(),
});

export type StockLevel = z.infer<typeof StockLevel>;

/** `GET /v1/accounts/{id}/stock`: the account's stock, item by item, and where it comes from. */
export const StockLevelsResult = z
  .object({
    accountId: z.uuid(),
    source: z.enum(['kept', 'books']),
    items: z.array(StockLevel),
    /** The whole stock's value at the account's prices; null when no line has a price. */
    value: z.string().nullable(),
  })
  .meta({ id: 'StockLevels' });
export type StockLevelsResult = z.infer<typeof StockLevelsResult>;

export const StockMovementResult = z
  .object({
    id: z.uuid(),
    kind: z.enum(STOCK_MOVEMENT_KINDS),
    item: ItemRef,
    /** Signed: what came in positive, what went out negative. */
    units: z.string(),
    occurredOn: z.iso.date(),
    /** What moved it: an order, a count, a person's entry or an import. */
    source: z.object({
      type: z.enum(['order', 'count', 'entry', 'import']),
      id: z.uuid().nullable(),
    }),
    note: z.string().nullable(),
    by: PersonRef.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'StockMovement' });
export type StockMovementResult = z.infer<typeof StockMovementResult>;

export const StockMovementQuery = z.strictObject({
  itemId: z.uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const StockMovementList = z
  .object({ items: z.array(StockMovementResult), nextCursor: z.string().nullable() })
  .meta({ id: 'StockMovements' });

/** What `POST /v1/stock/movements` did: the movements it made. */
export const RecordStockResult = z
  .object({ id: z.uuid(), movements: z.array(StockMovementResult) })
  .meta({ id: 'RecordStockResult' });

export const StockCountLine = z.object({
  item: ItemRef,
  counted: z.string(),
  expected: z.string(),
  difference: z.string(),
  flags: z.array(z.enum(COUNT_FLAGS)),
});

export const StockCountResult = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    countedAt: z.iso.datetime(),
    by: PersonRef.nullable(),
    note: z.string().nullable(),
    lines: z.array(StockCountLine),
    /** Whether any line was flagged, for the manager's eye. */
    flagged: z.boolean(),
  })
  .meta({ id: 'StockCount' });
export type StockCountResult = z.infer<typeof StockCountResult>;

export const StockCountQuery = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const StockCountList = z
  .object({ items: z.array(StockCountResult), nextCursor: z.string().nullable() })
  .meta({ id: 'StockCounts' });
