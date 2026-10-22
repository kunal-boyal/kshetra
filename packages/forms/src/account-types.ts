import { IconName, Key, LocalizedNoun, LocalizedText } from '@kshetra/shared';
import { z } from 'zod';
import { Condition } from './conditions';
import { CustomField } from './fields';

/**
 * Account types (spec 5.5). They live beside the fields they carry, so the config bundle, the apps
 * and the templates share one definition (decision D43); the checks that need a whole template,
 * such as designations that exist, stay in `@kshetra/templates`.
 */

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

/** An account type as the apps hold it: its definition at its current version. */
export const AccountTypeView = AccountType.extend({
  id: z.uuid(),
  version: z.int().min(1),
}).meta({ id: 'AccountTypeView' });

/** `GET /v1/account-types`. */
export const AccountTypeListResult = z.object({ items: z.array(AccountTypeView) });

/**
 * `POST /v1/account-types/{id}/versions`: the next version of a type's definition. Its key never
 * changes, and a field keeps its type once used, as user fields do.
 */
export const PublishAccountTypeBody = z.strictObject({ definition: AccountType });

/** `POST /v1/account-types`: a new type, with its own ID, at version 1 (M2). */
export const CreateAccountTypeBody = z.strictObject({ id: z.uuid(), definition: AccountType });

export type AccountTypeView = z.output<typeof AccountTypeView>;
export type CreateAccountTypeBody = z.output<typeof CreateAccountTypeBody>;
export type AccountTypeListResult = z.output<typeof AccountTypeListResult>;
export type PublishAccountTypeBody = z.output<typeof PublishAccountTypeBody>;
