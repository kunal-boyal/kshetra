import { type ErrorDetail, issueAt, Key } from '@thelamp/shared';
import { z } from 'zod';

type Path = readonly PropertyKey[];

/**
 * The canonical columns of spec Appendix B that templates can alias. A target also takes
 * `custom.<field>` for its custom fields, and accounts take `slot.<slot>` for each slot.
 */
export const IMPORT_COLUMNS = {
  users: [
    'code',
    'name',
    'mobile',
    'email',
    'designation',
    'role',
    'reports_to',
    'territory_codes',
    'calendar',
    'joining_date',
  ],
  accounts: [
    'code',
    'name',
    'territory_code',
    'parent_code',
    'latitude',
    'longitude',
    'geofence_radius_m',
    'address',
    'city',
    'state',
    'pin',
    'active',
  ],
  items: [
    'item_code',
    'item_name',
    'product_name',
    'category',
    'pack_label',
    'base_unit',
    'case_factor',
    'measure_type',
    'measure_per_base_unit',
    'measure_per_case',
    'hsn',
    'tax_rate',
    'mrp',
    'price',
    'discount_pct',
    'expected_net_price',
    'expected_final_price',
    'price_list',
  ],
} as const;

/** Percentage columns an import may read as fractions when the mapping marks them (BR-17). */
export const FRACTION_COLUMNS: Readonly<Record<keyof typeof IMPORT_COLUMNS, readonly string[]>> = {
  users: [],
  accounts: [],
  items: ['tax_rate', 'discount_pct'],
};

/** A header as the importer compares it: lowercased, with everything but letters and digits removed. */
const Alias = z
  .string()
  .regex(
    /^[a-z0-9]{1,60}$/,
    'Write the header as the import compares it: lowercase letters and digits only',
  );

/** How one import target reads a customer's files (module M19). */
export const ImportTarget = z
  .strictObject({
    aliases: z
      .record(
        z.string().regex(/^(?:[a-z][a-z0-9_]*|(?:custom|slot)\.[a-z][a-z0-9_]{0,39})$/),
        z.array(Alias).min(1).max(20),
      )
      .default({})
      .meta({
        description:
          'Other headers for each column: an Appendix B column, custom.<field> or slot.<slot>',
      }),
    emptyValues: z.array(z.string().min(1).max(40)).max(20).default([]).meta({
      description: 'Cell values that mean empty, such as "-"',
    }),
    fractions: z.array(z.string()).max(10).default([]).meta({
      description: 'Percentage columns where a value of 1 or less is a fraction (BR-17)',
    }),
  })
  .meta({ id: 'ImportTarget' });

/** Import column aliases, by target. */
export const Imports = z
  .strictObject({
    users: ImportTarget.optional(),
    accounts: z.record(Key, ImportTarget).optional().meta({ description: 'By account type' }),
    items: ImportTarget.optional(),
  })
  .meta({ id: 'Imports' });

export type ImportTarget = z.output<typeof ImportTarget>;
export type Imports = z.output<typeof Imports>;

/** The columns of one target that aliases may name. */
interface Columns {
  canonical: readonly string[];
  fractions: readonly string[];
  custom: readonly string[];
  slots: readonly string[];
}

function checkTarget(target: ImportTarget, columns: Columns, path: Path): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const known = new Set([
    ...columns.canonical,
    ...columns.custom.map((key) => `custom.${key}`),
    ...columns.slots.map((key) => `slot.${key}`),
  ]);
  const owner = new Map<string, string>();
  for (const [column, aliases] of Object.entries(target.aliases)) {
    if (!known.has(column)) {
      issues.push(issueAt([...path, 'aliases', column], `There is no column \`${column}\``));
    }
    aliases.forEach((alias, index) => {
      const taken = owner.get(alias);
      if (taken !== undefined) {
        issues.push(
          issueAt(
            [...path, 'aliases', column, index],
            `\`${alias}\` already stands for \`${taken}\``,
          ),
        );
      }
      owner.set(alias, column);
    });
  }
  target.fractions.forEach((column, index) => {
    if (!columns.fractions.includes(column)) {
      issues.push(
        issueAt([...path, 'fractions', index], `\`${column}\` is not a percentage column`),
      );
    }
  });
  return issues;
}

/** What import aliases may refer to, beyond the canonical columns. */
export interface ImportContext {
  userFields: readonly string[];
  /** Account types by key, with their slot and custom field keys. */
  accountTypes: ReadonlyMap<string, { slots: readonly string[]; fields: readonly string[] }>;
  /** Custom item fields, when the template sets up the catalogue. */
  itemFields: readonly string[];
}

/** Checks that aliases name real columns, each alias names one column, and fractions fit. */
export function checkImports(imports: Imports, context: ImportContext, path: Path): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  if (imports.users) {
    issues.push(
      ...checkTarget(
        imports.users,
        {
          canonical: IMPORT_COLUMNS.users,
          fractions: FRACTION_COLUMNS.users,
          custom: context.userFields,
          slots: [],
        },
        [...path, 'users'],
      ),
    );
  }
  for (const [key, target] of Object.entries(imports.accounts ?? {})) {
    const type = context.accountTypes.get(key);
    if (!type) {
      issues.push(issueAt([...path, 'accounts', key], `There is no account type \`${key}\``));
      continue;
    }
    issues.push(
      ...checkTarget(
        target,
        {
          canonical: IMPORT_COLUMNS.accounts,
          fractions: FRACTION_COLUMNS.accounts,
          custom: type.fields,
          slots: type.slots,
        },
        [...path, 'accounts', key],
      ),
    );
  }
  if (imports.items) {
    issues.push(
      ...checkTarget(
        imports.items,
        {
          canonical: IMPORT_COLUMNS.items,
          fractions: FRACTION_COLUMNS.items,
          custom: context.itemFields,
          slots: [],
        },
        [...path, 'items'],
      ),
    );
  }
  return issues;
}
