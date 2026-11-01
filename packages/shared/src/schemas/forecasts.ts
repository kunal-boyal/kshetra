import { z } from 'zod';
import { Period } from './planning';
import { StockQuantity } from './sell-through';

/**
 * Product forecasts per account (BR-54, decision D126): an account's expected quantity by item
 * for a month, kept as versions; the latest counts, and a month locks on its 1st.
 */

const Person = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

export const ForecastLineBody = z.strictObject({
  itemId: z.uuid(),
  /** 0 takes the item out of the month's forecast. */
  quantity: StockQuantity,
});

/**
 * `PUT /v1/accounts/{id}/forecasts/{period}`: a new version of the month's forecast, with the
 * client's ID for it. Items left out keep their quantities; a locked month needs a reason.
 */
export const SaveForecastBody = z
  .strictObject({
    id: z.uuid(),
    lines: z.array(ForecastLineBody).min(1).max(500),
    reason: z.string().trim().min(1).max(300).optional(),
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

export const ForecastParams = z.strictObject({ id: z.uuid(), period: Period });
export const ForecastQuery = z.strictObject({ from: Period, to: Period });

export const ForecastVersion = z.object({
  id: z.uuid(),
  version: z.int(),
  recordedBy: Person,
  recordedAt: z.iso.datetime(),
  /** Set when it changed the month after its lock (BR-54). */
  reason: z.string().nullable(),
  afterLock: z.boolean(),
});

/** One month of an account's forecast: its latest version's items, and every version. */
export const ForecastMonth = z.object({
  period: Period,
  /** Whether the month may still change without the override (BR-54). */
  open: z.boolean(),
  lines: z.array(
    z.object({
      item: z.object({ id: z.uuid(), code: z.string(), name: z.string(), baseUnit: z.string() }),
      quantity: z.string(),
    }),
  ),
  versions: z.array(ForecastVersion),
});

export const ForecastResult = z
  .object({
    account: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    months: z.array(ForecastMonth),
  })
  .meta({ id: 'ForecastResult' });

export type ForecastLineBody = z.output<typeof ForecastLineBody>;
export type SaveForecastBody = z.output<typeof SaveForecastBody>;
export type ForecastVersion = z.infer<typeof ForecastVersion>;
export type ForecastMonth = z.infer<typeof ForecastMonth>;
export type ForecastResult = z.infer<typeof ForecastResult>;
