import { z } from 'zod';
import { SELL_THROUGH_FLAGS } from '../sell-through';
import { Period } from './planning';

/**
 * Sell-through by item (BR-53, decision D124): an account's monthly stock statement, item by item,
 * saved as versions; the latest counts. Templates give it its word, such as liquidation.
 */

/** A count of stock in the item's base unit: none or more, up to 3 places. */
export const StockQuantity = z
  .string()
  .regex(/^\d{1,12}(?:\.\d{1,3})?$/, 'Write a quantity such as 12 or 0.5');

const Person = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

/** One item's stock to set. Opening left out carries last month's closing, else 0. */
export const SellThroughLineBody = z.strictObject({
  itemId: z.uuid(),
  opening: StockQuantity.optional(),
  received: StockQuantity,
  returned: StockQuantity.default('0'),
  closing: StockQuantity,
});

/**
 * `PUT /v1/accounts/{id}/sell-through/{period}`: a new version of the month's statement, with the
 * client's ID for it. Items left out keep their latest lines.
 */
export const SaveSellThroughBody = z
  .strictObject({
    id: z.uuid(),
    lines: z.array(SellThroughLineBody).min(1).max(500),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.lines.forEach((line, index) => {
      if (seen.has(line.itemId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'itemId'],
          message: 'Name each item once',
        });
      }
      seen.add(line.itemId);
    });
  });

export const SellThroughParams = z.strictObject({ id: z.uuid(), period: Period });
export const SellThroughQuery = z.strictObject({ period: Period });
export const SellThroughVersionParams = z.strictObject({
  id: z.uuid(),
  period: Period,
  version: z.coerce.number().int().min(1),
});

export const SellThroughLine = z.object({
  item: z.object({ id: z.uuid(), code: z.string(), name: z.string(), baseUnit: z.string() }),
  opening: z.string(),
  received: z.string(),
  returned: z.string(),
  closing: z.string(),
  /** Opening + received − returned − closing; negative is flagged (BR-53). */
  sold: z.string(),
  /** Last month's closing, carried forward; null when there was none. */
  carried: z.string().nullable(),
  /** The account's price for the item on the credited day, before tax; null without one. */
  unitPrice: z.string().nullable(),
  value: z.string().nullable(),
  flags: z.array(z.enum(SELL_THROUGH_FLAGS)),
});

export const SellThroughVersion = z.object({
  id: z.uuid(),
  version: z.int(),
  recordedBy: Person,
  recordedAt: z.iso.datetime(),
  /** The day it counts on, for whoever recorded it (BR-53). */
  creditedOn: z.iso.date(),
  value: z.string().nullable(),
});

/** An account's statement for a month: its latest version's lines, and every version. */
export const SellThroughResult = z
  .object({
    account: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    period: Period,
    /** Whether the month may still change (BR-53). */
    open: z.boolean(),
    /** The version shown: the latest, or the one asked for; null before any. */
    statement: SellThroughVersion.extend({
      flags: z.array(z.enum(SELL_THROUGH_FLAGS)),
      lines: z.array(SellThroughLine),
    }).nullable(),
    /** Last month's closing for each item, where this month has no line for it yet. */
    carried: z.array(z.object({ itemId: z.uuid(), closing: z.string() })),
    versions: z.array(SellThroughVersion),
  })
  .meta({ id: 'SellThroughResult' });

export type StockQuantity = z.infer<typeof StockQuantity>;
export type SellThroughLineBody = z.output<typeof SellThroughLineBody>;
export type SaveSellThroughBody = z.output<typeof SaveSellThroughBody>;
export type SellThroughLine = z.infer<typeof SellThroughLine>;
export type SellThroughVersion = z.infer<typeof SellThroughVersion>;
export type SellThroughResult = z.infer<typeof SellThroughResult>;
