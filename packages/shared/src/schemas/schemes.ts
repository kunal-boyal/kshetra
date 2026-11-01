import { z } from 'zod';
import { SCHEME_KINDS, SCHEME_MAX_SLABS } from '../schemes';
import { Percent } from './catalogue';
import { Key, LocalizedText, Money } from './config';
import { StockQuantity } from './sell-through';

/**
 * Schemes and promotions on orders (M10, BR-55, decision D127): a percentage off, a flat amount
 * per unit, quantity slabs or free goods, for chosen items or categories, account types and
 * territories, between two dates. Orders take the one best for the customer on each line.
 */

export const SchemeKind = z.enum(SCHEME_KINDS).meta({ id: 'SchemeKind' });

const CalendarDate = z.iso.date();

export const SchemeRuleBody = z
  .strictObject({
    percent: Percent.optional(),
    amount: Money.optional(),
    slabs: z
      .array(z.strictObject({ from: StockQuantity, percent: Percent }))
      .max(SCHEME_MAX_SLABS)
      .optional(),
    buy: StockQuantity.optional(),
    get: StockQuantity.optional(),
    freeItemId: z.uuid().nullable().optional(),
  })
  .meta({ id: 'SchemeRule' });

/** `PUT /v1/schemes/{id}`: adds a scheme, or changes it at the version the editor saw. */
export const SchemeBody = z
  .strictObject({
    key: Key,
    name: LocalizedText,
    kind: SchemeKind,
    rule: SchemeRuleBody,
    itemIds: z.array(z.uuid()).max(500).default([]),
    categoryIds: z.array(z.uuid()).max(100).default([]),
    accountTypeKeys: z.array(Key).max(20).default([]),
    territoryIds: z.array(z.uuid()).max(200).default([]),
    validFrom: CalendarDate,
    validTo: CalendarDate.nullable().default(null),
    active: z.boolean().default(true),
    /** The version the editor saw; left out only when adding the scheme. */
    version: z.int().min(1).optional(),
  })
  .meta({ id: 'SchemeBody' });

export const SchemeResult = z
  .object({
    id: z.uuid(),
    key: Key,
    name: LocalizedText,
    kind: SchemeKind,
    rule: SchemeRuleBody,
    itemIds: z.array(z.uuid()),
    categoryIds: z.array(z.uuid()),
    accountTypeKeys: z.array(Key),
    territoryIds: z.array(z.uuid()),
    validFrom: CalendarDate,
    validTo: CalendarDate.nullable(),
    active: z.boolean(),
    version: z.int().min(1),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Scheme' });

export const SchemeListResult = z.object({ items: z.array(SchemeResult) });
export const SchemeParams = z.strictObject({ schemeId: z.uuid() });

/** What a device showed for a line's scheme: which one, and what it took off (BR-14, BR-55). */
export const QuotedScheme = z.strictObject({ key: Key, discount: Money });

/** Goods a device showed free, for the line of `ofItemId` (BR-55). */
export const QuotedFree = z.strictObject({
  itemId: z.uuid(),
  baseUnits: StockQuantity,
  ofItemId: z.uuid(),
});

export type SchemeRuleBody = z.output<typeof SchemeRuleBody>;
export type SchemeBody = z.output<typeof SchemeBody>;
export type SchemeResult = z.infer<typeof SchemeResult>;
export type SchemeListResult = z.infer<typeof SchemeListResult>;
export type QuotedScheme = z.infer<typeof QuotedScheme>;
export type QuotedFree = z.infer<typeof QuotedFree>;
