import { z } from 'zod';
import { MEASURE_TYPES } from '../catalogue';
import { Key, LocalizedNoun } from './config';

/**
 * The catalogue (spec 5.11): categories, products and the items sold. Phase 1 carries items
 * without prices, for forms' product lines and catalogue selects (decision D38); prices and
 * price lists join in phase 2.
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
