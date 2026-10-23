import { z } from 'zod';
import { MEASURE_TYPES } from '../catalogue';
import { PRICE_LIST_SCOPES } from '../pricing';
import { Key, LocalizedNoun, Money } from './config';

/**
 * The catalogue (spec 5.11): categories, products, the items sold and the price lists that price
 * them (decision D77).
 */

export const CatalogueUnitView = z.object({ key: Key, name: LocalizedNoun, base: z.boolean() });

export const ItemResult = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    product: z.object({ id: z.uuid(), name: z.string() }),
    category: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    packLabel: z.string().nullable(),
    hsn: z.string().nullable(),
    /** A percentage, as a decimal string such as `18.0000`. */
    taxRate: z.string(),
    /** Display only, as a decimal string. */
    mrp: z.string().nullable(),
    baseUnit: Key,
    /** Each unit the item comes in, with how many base units it holds. */
    units: z.array(z.object({ key: Key, factor: z.string() })),
    measureType: z.enum(MEASURE_TYPES).nullable(),
    /** As a decimal string, in kg or L. */
    measurePerBaseUnit: z.string().nullable(),
    custom: z.record(z.string(), z.unknown()),
    active: z.boolean(),
  })
  .meta({ id: 'Item' });

/**
 * `GET /v1/catalogue`: everything the apps need to offer items, behind an ETag that moves with
 * every change, so a phone that has it current pays one lookup.
 */
export const CatalogueResult = z.object({
  version: z.int().min(0),
  units: z.array(CatalogueUnitView),
  measureTypes: z.array(z.enum(MEASURE_TYPES)),
  items: z.array(ItemResult),
});

export type CatalogueUnitView = z.infer<typeof CatalogueUnitView>;
export type ItemResult = z.infer<typeof ItemResult>;
export type CatalogueResult = z.infer<typeof CatalogueResult>;

const CalendarDate = z.iso.date();

/** A percentage from 0 to 100 with up to 4 places, as a decimal string. */
export const Percent = z
  .string()
  .regex(
    /^(?:100(?:\.0{1,4})?|\d{1,2}(?:\.\d{1,4})?)$/,
    'Write a percentage from 0 to 100, such as 12.5',
  )
  .meta({ id: 'Percent' });

/** How many base units a unit holds: more than 0, up to 3 places. */
export const UnitFactor = z
  .string()
  .regex(/^\d{1,12}(?:\.\d{1,3})?$/, 'Write a number such as 12 or 0.5')
  .refine((text) => /[1-9]/.test(text), 'A unit holds more than nothing');

/** An item's measure per base unit in kg or L: more than 0, up to 6 places. */
export const MeasureAmount = z
  .string()
  .regex(/^\d{1,9}(?:\.\d{1,6})?$/, 'Write a number such as 0.5')
  .refine((text) => /[1-9]/.test(text), 'A measure is more than nothing');

/**
 * `PUT /v1/items/{itemId}` (spec 11.2): adds the item with the caller's ID, or replaces it. The
 * product and category are found by name, or made. The base unit holds 1; every other unit names
 * how many base units it holds.
 */
export const ItemBody = z
  .strictObject({
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(200),
    productName: z.string().trim().min(1).max(200),
    categoryName: z.string().trim().min(1).max(200).nullable(),
    packLabel: z.string().trim().min(1).max(60).nullable(),
    hsn: z.string().trim().min(1).max(20).nullable(),
    taxRate: Percent,
    mrp: Money.nullable(),
    baseUnit: Key,
    units: z.array(z.object({ key: Key, factor: UnitFactor })).max(10),
    measureType: z.enum(MEASURE_TYPES).nullable(),
    measurePerBaseUnit: MeasureAmount.nullable(),
    custom: z.record(z.string(), z.unknown()).default({}),
    active: z.boolean().default(true),
  })
  .meta({ id: 'ItemBody' });

export const PriceListScope = z.enum(PRICE_LIST_SCOPES);

/** `PUT /v1/price-lists/{priceListId}`: adds the list with the caller's ID, or changes it. */
export const PriceListBody = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    scope: PriceListScope,
    /** Account type keys, segment keys, territory IDs or account IDs; none for a default list. */
    targets: z.array(z.string().min(1).max(64)).max(500).default([]),
    priority: z.int().min(-1000).max(1000).default(0),
    validFrom: CalendarDate,
    validTo: CalendarDate.nullable().default(null),
    active: z.boolean().default(true),
    /** The version the editor saw; left out only when adding the list. */
    version: z.int().min(1).optional(),
  })
  .meta({ id: 'PriceListBody' });

export const PriceListResult = z
  .object({
    id: z.uuid(),
    name: z.string(),
    scope: PriceListScope,
    targets: z.array(z.string()),
    priority: z.int(),
    validFrom: CalendarDate,
    validTo: CalendarDate.nullable(),
    active: z.boolean(),
    version: z.int().min(1),
    /** How many items it prices. */
    itemCount: z.int().min(0),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'PriceList' });

export const PriceListListResult = z.object({ items: z.array(PriceListResult) });

export const PriceListParams = z.strictObject({ priceListId: z.uuid() });
export const ItemParams = z.strictObject({ itemId: z.uuid() });

export const PriceListItemsQuery = z.strictObject({
  /** Matches an item's code or name. */
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** The last item code of the previous page. */
  cursor: z.string().max(40).optional(),
});

export const PriceListEntry = z
  .object({
    item: z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      packLabel: z.string().nullable(),
      baseUnit: Key,
      taxRate: z.string(),
    }),
    /** Per base unit. */
    price: z.string(),
    discount: z.string(),
    /** BR-10: the net rate per base unit. */
    rate: z.string(),
  })
  .meta({ id: 'PriceListEntry' });

/** `GET /v1/price-lists/{id}/items`: a list's prices by item code, a page at a time. */
export const PriceListItemsResult = z.object({
  items: z.array(PriceListEntry),
  nextCursor: z.string().nullable(),
});

/** `PUT /v1/price-lists/{id}/items`: sets prices and removes items, at the list's version. */
export const PriceListItemsBody = z
  .strictObject({
    set: z
      .array(z.strictObject({ itemId: z.uuid(), price: Money, discount: Percent.default('0') }))
      .max(500)
      .default([]),
    remove: z.array(z.uuid()).max(500).default([]),
    version: z.int().min(1),
  })
  .refine((body) => body.set.length + body.remove.length > 0, 'Set or remove at least one price')
  .meta({ id: 'PriceListItemsBody' });

export const AccountPricesQuery = z.strictObject({
  /** A calendar date on the tenant's clock; today when left out. */
  date: CalendarDate.optional(),
});

/** `GET /v1/accounts/{accountId}/prices`: what each item costs at an account on a date (spec 5.11). */
export const AccountPricesResult = z.object({
  date: CalendarDate,
  /** The lists that apply, the most specific first. */
  lists: z.array(z.object({ id: z.uuid(), name: z.string(), scope: PriceListScope })),
  items: z.array(
    z.object({
      itemId: z.uuid(),
      listId: z.uuid(),
      price: z.string(),
      discount: z.string(),
      rate: z.string(),
    }),
  ),
});

export type Percent = z.infer<typeof Percent>;
export type ItemBody = z.output<typeof ItemBody>;
export type PriceListBody = z.output<typeof PriceListBody>;
export type PriceListResult = z.infer<typeof PriceListResult>;
export type PriceListListResult = z.infer<typeof PriceListListResult>;
export type PriceListItemsQuery = z.output<typeof PriceListItemsQuery>;
export type PriceListEntry = z.infer<typeof PriceListEntry>;
export type PriceListItemsResult = z.infer<typeof PriceListItemsResult>;
export type PriceListItemsBody = z.output<typeof PriceListItemsBody>;
export type AccountPricesQuery = z.output<typeof AccountPricesQuery>;
export type AccountPricesResult = z.infer<typeof AccountPricesResult>;
