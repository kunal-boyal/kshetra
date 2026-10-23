import { checkFields, CustomField } from '@thelamp/forms';
import {
  type ErrorDetail,
  issueAt,
  Key,
  LocalizedNoun,
  LocalizedText,
  PRICE_ROUNDINGS,
  repeats,
} from '@thelamp/shared';
import { z } from 'zod';
import { repeatedKeys } from './organisation';

type Path = readonly PropertyKey[];

/** A unit items sell in. Each item sets its own factor for each unit (spec 5.11). */
export const CatalogueUnit = z
  .strictObject({
    key: Key,
    name: LocalizedNoun,
    base: z.boolean().default(false).meta({
      description: 'The unit prices refer to. Exactly one unit is the base.',
    }),
  })
  .meta({ id: 'CatalogueUnit' });

/** Catalogue and order settings (spec 5.11). */
export const Catalogue = z
  .strictObject({
    units: z.array(CatalogueUnit).min(1).max(10),
    measureTypes: z
      .array(z.enum(['kg', 'L']))
      .max(2)
      .default([])
      .meta({
        description: 'Physical measures totalled on orders (BR-11)',
      }),
    rounding: z.enum(PRICE_ROUNDINGS).default('per_unit_first').meta({
      description: "Round each unit's net rate before multiplying, or only the totals (BR-10)",
    }),
    itemFields: z.array(CustomField).max(30).default([]),
    rejectionReasons: z
      .array(z.strictObject({ key: Key, name: LocalizedText }))
      .min(1)
      .max(50)
      .meta({ description: 'Reasons for rejecting an order or an order line' }),
  })
  .meta({ id: 'Catalogue' });

export type Catalogue = z.output<typeof Catalogue>;

/** Checks catalogue settings: one base unit, unique keys and sound item fields. */
export function checkCatalogue(catalogue: Catalogue, path: Path): ErrorDetail[] {
  const issues = [
    ...repeatedKeys(catalogue.units, [...path, 'units'], 'Unit'),
    ...repeatedKeys(catalogue.rejectionReasons, [...path, 'rejectionReasons'], 'Reason'),
    ...checkFields(catalogue.itemFields, { accountTypes: new Map(), linkedAccountTypes: [] }, [
      ...path,
      'itemFields',
    ]),
  ];
  const bases = catalogue.units.filter((unit) => unit.base).length;
  if (bases !== 1) {
    issues.push(issueAt([...path, 'units'], `Mark exactly one unit as the base; ${bases} are`));
  }
  for (const index of repeats(catalogue.measureTypes)) {
    issues.push(
      issueAt(
        [...path, 'measureTypes', index],
        `\`${catalogue.measureTypes[index]}\` appears more than once`,
      ),
    );
  }
  return issues;
}
