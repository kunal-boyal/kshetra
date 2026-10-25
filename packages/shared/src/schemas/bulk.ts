import { z } from 'zod';
import { Key, LocalizedText } from './config';

/**
 * Bulk upserts (spec 11.2, module M20, decision D94): rows of a master as JSON, keyed by the same
 * fields its file import has, checked and written all or nothing, as an import is.
 */

/** A cell: text, a number, yes or no, or nothing. Dates are `YYYY-MM-DD` text. */
const BulkCell = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

export const BulkRows = z
  .array(z.record(z.string().regex(/^[a-z][a-z0-9_.]{0,79}$/), BulkCell))
  .min(1)
  .max(1000);

export const BulkBody = z.strictObject({ rows: BulkRows }).meta({ id: 'BulkBody' });

/** Accounts are loaded one type at a time, as their fields differ by type. */
export const BulkAccountsBody = z
  .strictObject({ accountType: Key, rows: BulkRows })
  .meta({ id: 'BulkAccountsBody' });

export const BulkResult = z
  .object({ created: z.int().min(0), updated: z.int().min(0) })
  .meta({ id: 'BulkResult' });

export const BULK_TARGETS = [
  'users',
  'accounts',
  'items',
  'ledger-entries',
  'external-metrics',
] as const;

/** `GET /v1/bulk/fields`: a bulk target's fields, custom fields included. */
export const BulkFieldsQuery = z.strictObject({
  target: z.enum(BULK_TARGETS),
  /** For accounts, the type whose fields to list. */
  accountType: Key.optional(),
});

export const BulkFieldsResult = z
  .object({
    fields: z.array(
      z.object({ key: z.string(), required: z.boolean(), label: LocalizedText.nullable() }),
    ),
  })
  .meta({ id: 'BulkFields' });

export type BulkTarget = (typeof BULK_TARGETS)[number];
