import { type AnyField, checkCondition, checkFields, Condition, CustomField } from '@kshetra/forms';
import {
  type ErrorDetail,
  IconName,
  issueAt,
  Key,
  LocalizedNoun,
  LocalizedText,
  repeats,
} from '@kshetra/shared';
import { z } from 'zod';
import { repeatedKeys } from './organisation';

type Path = readonly PropertyKey[];

/** A named slot on an account that a user fills, such as the regional manager (spec 5.5). */
export const AssignmentSlot = z
  .strictObject({
    key: Key,
    name: LocalizedText,
    designations: z.array(Key).min(1).max(10).meta({
      description: 'The designations allowed in the slot',
    }),
    required: z.boolean().default(false),
    priority: z.int().min(1).max(10).meta({
      description: '1 is the highest. The primary assignee is the highest-priority filled slot.',
    }),
  })
  .meta({ id: 'AssignmentSlot' });

/** Tags accounts with a segment when their field values match, re-evaluated on every change. */
export const SegmentRule = z
  .strictObject({ segment: Key, name: LocalizedText, when: Condition })
  .meta({ id: 'SegmentRule' });

/** A class of account with its own fields, slots and rules (spec 5.5). */
export const AccountType = z
  .strictObject({
    key: Key,
    name: LocalizedNoun,
    icon: IconName,
    active: z.boolean().default(true).meta({
      description: 'An inactive type is provisioned switched off, for the admin to switch on',
    }),
    parentTypes: z.array(Key).max(10).default([]).meta({
      description: 'Types an account of this type may belong to; a parent can supply its orders',
    }),
    code: z
      .discriminatedUnion('mode', [
        z.strictObject({ mode: z.literal('manual') }),
        z.strictObject({
          mode: z.literal('auto'),
          prefix: z
            .string()
            .regex(/^[A-Z][A-Z0-9-]{0,7}$/, 'Use 1–8 capital letters, digits or hyphens'),
        }),
      ])
      .meta({ description: 'Codes typed in, or numbered automatically after a prefix' }),
    fields: z.array(CustomField).max(50).default([]),
    location: z.strictObject({
      required: z.boolean().default(false).meta({
        description: 'Whether every account needs coordinates',
      }),
      geofenceRadiusM: z.int().min(50).max(5000).optional().meta({
        description: "Leave out to use the tenant's default radius",
      }),
      geofencePolicy: z.enum(['off', 'advisory', 'required']).default('advisory').meta({
        description: 'What forms that inherit the policy do outside the fence (D7: advisory)',
      }),
      fieldUsersMayPropose: z.boolean().default(true).meta({
        description: 'Whether field users may propose a location for an account without one',
      }),
    }),
    creation: z.enum(['admins', 'field_users_with_approval']).default('admins').meta({
      description: 'Who creates accounts; field users go through the new_account workflow',
    }),
    slots: z.array(AssignmentSlot).min(1).max(10),
    segmentRules: z.array(SegmentRule).max(20).default([]),
    visitFrequencyNorms: z
      .array(z.strictObject({ segment: Key, visitsPerMonth: z.int().min(1).max(31) }))
      .max(20)
      .default([])
      .meta({ description: 'Expected visits per month to accounts in a segment' }),
    contacts: z.boolean().default(false).meta({
      description: 'Whether accounts of this type hold contact people',
    }),
  })
  .meta({ id: 'AccountType' });

export type AccountType = z.output<typeof AccountType>;

function checkAccountType(
  type: AccountType,
  typeKeys: ReadonlySet<string>,
  designations: ReadonlySet<string>,
  path: Path,
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const at = (rest: readonly PropertyKey[], issue: string) =>
    issues.push(issueAt([...path, ...rest], issue));

  type.parentTypes.forEach((parent, index) => {
    if (!typeKeys.has(parent)) at(['parentTypes', index], `There is no account type \`${parent}\``);
  });
  for (const index of repeats(type.parentTypes)) {
    at(
      ['parentTypes', index],
      `Account type \`${type.parentTypes[index]}\` appears more than once`,
    );
  }

  issues.push(
    ...checkFields(type.fields, { accountTypes: new Map(), linkedAccountTypes: [] }, [
      ...path,
      'fields',
    ]),
  );

  issues.push(...repeatedKeys(type.slots, [...path, 'slots'], 'Slot'));
  const priorities = type.slots.map((slot) => String(slot.priority));
  for (const index of repeats(priorities)) {
    at(['slots', index, 'priority'], `Another slot already has priority ${priorities[index]}`);
  }
  type.slots.forEach((slot, index) => {
    slot.designations.forEach((designation, d) => {
      if (!designations.has(designation)) {
        at(['slots', index, 'designations', d], `There is no designation \`${designation}\``);
      }
    });
  });

  const fields = new Map<string, AnyField>(type.fields.map((field) => [field.key, field]));
  const segments = type.segmentRules.map((rule) => rule.segment);
  for (const index of repeats(segments)) {
    at(['segmentRules', index, 'segment'], `Segment \`${segments[index]}\` appears more than once`);
  }
  type.segmentRules.forEach((rule, index) => {
    issues.push(
      ...checkCondition(
        rule.when,
        fields,
        [...path, 'segmentRules', index, 'when'],
        (key) => `Account type \`${type.key}\` has no field \`${key}\``,
      ),
    );
  });

  const normed = type.visitFrequencyNorms.map((norm) => norm.segment);
  normed.forEach((segment, index) => {
    if (!segments.includes(segment)) {
      at(['visitFrequencyNorms', index, 'segment'], `No segment rule tags \`${segment}\``);
    }
  });
  for (const index of repeats(normed)) {
    at(
      ['visitFrequencyNorms', index, 'segment'],
      `Segment \`${normed[index]}\` appears more than once`,
    );
  }
  return issues;
}

/** Checks account types beyond their shape: references, slots, segments and fields. */
export function checkAccountTypes(
  types: readonly AccountType[],
  designations: ReadonlySet<string>,
  path: Path,
): ErrorDetail[] {
  const typeKeys = new Set(types.map((type) => type.key));
  return [
    ...repeatedKeys(types, path, 'Account type'),
    ...types.flatMap((type, index) =>
      checkAccountType(type, typeKeys, designations, [...path, index]),
    ),
  ];
}
