import { z } from 'zod';
import { EmailAddress } from '../phone';
import { GeoPoint } from '../geo';
import { PhoneInput } from './auth';
import { Key } from './config';

/**
 * Accounts (spec 5.5, module M4): every outside party the field team works with, of a type the
 * tenant configures. The type's definition carries form-engine fields, so its schemas live in
 * `@thelamp/forms` (decision D43); these carry only values.
 */

export const ACCOUNT_STATUSES = ['pending', 'active', 'inactive'] as const;
export const AccountStatus = z.enum(ACCOUNT_STATUSES);

export const LOCATION_STATUSES = ['unverified', 'verified'] as const;
export const LocationStatus = z.enum(LOCATION_STATUSES);

export const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const ProposalStatus = z.enum(PROPOSAL_STATUSES);

const CalendarDate = z.iso.date();

export const AccountCode = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/,
    'Use up to 40 letters, digits, dots, dashes, slashes or underscores',
  );
const AccountName = z.string().trim().min(1).max(200);
const Radius = z.int().min(50).max(5000).meta({ description: 'Geofence radius in metres' });

export const AccountAddress = z
  .strictObject({
    line: z.string().trim().max(300).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    pin: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Write the 6-digit PIN code')
      .optional(),
  })
  .meta({ id: 'AccountAddress' });

const Ref = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

/** Who fills a slot of an account, from when. */
export const AccountSlotHolder = z.object({
  slot: Key,
  user: Ref,
  validFrom: CalendarDate,
});

export const AccountResult = z
  .object({
    id: z.uuid(),
    type: Key,
    code: z.string(),
    name: z.string(),
    territory: Ref,
    parent: Ref.nullable(),
    address: AccountAddress,
    location: GeoPoint.nullable(),
    /** The account's own radius; null takes its type's, then the tenant's. */
    geofenceRadiusM: z.int().nullable(),
    locationStatus: LocationStatus,
    status: AccountStatus,
    segments: z.array(Key),
    custom: z.record(z.string(), z.unknown()),
    /** Today's slot holders. */
    slots: z.array(AccountSlotHolder),
    /** The slot whose holder is the primary assignee: the highest-priority filled slot. */
    primarySlot: Key.nullable(),
    /**
     * Required slots nobody fills today, as an approved proposal can leave them; admins fill
     * them from the account (decision D43).
     */
    missingSlots: z.array(Key),
    /** The latest outstanding balance; null without one, or while account finance is off. */
    outstanding: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Account' });

export const AccountListQuery = z.strictObject({
  type: Key.optional(),
  q: z.string().trim().min(1).max(100).optional().meta({ description: 'Part of a name or code' }),
  status: AccountStatus.optional(),
  territoryId: z.uuid().optional().meta({ description: 'This territory and everything under it' }),
  segment: Key.optional(),
  userId: z.uuid().optional().meta({ description: 'Accounts whose slots this person fills today' }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.uuid().optional(),
});

export const AccountListResult = z.object({
  items: z.array(AccountResult),
  nextCursor: z.uuid().nullable(),
  /**
   * With the first page only (null after), under the filters but type and status: how many active
   * and pending accounts each type holds, and how many of the type asked for wait for approval
   * (decision D104).
   */
  summary: z.object({ types: z.record(Key, z.int()), pending: z.int() }).nullable(),
});

/**
 * Who fills each slot, by slot key, from a day on (today unless given); null empties a slot. Slots
 * left out stay as they are.
 */
export const SlotChanges = z.strictObject({
  holders: z.record(Key, z.uuid().nullable()),
  from: CalendarDate.optional().meta({
    description: 'The first day the change applies; today if left out',
  }),
});

/**
 * `POST /v1/accounts`, with the ID made by the client (spec 10.1). Someone who may manage accounts
 * adds an active one; a field user who may propose adds a `pending` one, which their manager
 * decides (M4, decision D38). The code is left out when the type numbers its accounts.
 */
export const CreateAccountBody = z.strictObject({
  id: z.uuid(),
  type: Key,
  code: AccountCode.optional(),
  name: AccountName,
  territoryId: z.uuid(),
  parentId: z.uuid().optional(),
  address: AccountAddress.optional(),
  location: GeoPoint.optional(),
  geofenceRadiusM: Radius.optional(),
  slots: z.record(Key, z.uuid()).optional().meta({ description: 'Who fills each slot from today' }),
  custom: z.record(z.string(), z.unknown()).optional(),
});

/** `PATCH /v1/accounts/{id}`: send only what changes; null clears. */
export const UpdateAccountBody = z
  .strictObject({
    code: AccountCode.optional(),
    name: AccountName.optional(),
    territoryId: z.uuid().optional(),
    parentId: z.uuid().nullable().optional(),
    address: AccountAddress.optional(),
    location: GeoPoint.nullable().optional(),
    geofenceRadiusM: Radius.nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    slots: SlotChanges.optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');

export const ContactResult = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    name: z.string(),
    role: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    active: z.boolean(),
  })
  .meta({ id: 'Contact' });

const ContactFields = {
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(100),
  phone: PhoneInput,
  email: EmailAddress,
};

/** `POST /v1/accounts/{id}/contacts`, with the ID made by the client. */
export const CreateContactBody = z.strictObject({
  id: z.uuid(),
  name: ContactFields.name,
  role: ContactFields.role.optional(),
  phone: ContactFields.phone.optional(),
  email: ContactFields.email.optional(),
});

/** `PATCH /v1/accounts/{id}/contacts/{contactId}`: send only what changes; null clears. */
export const UpdateContactBody = z
  .strictObject({
    name: ContactFields.name.optional(),
    role: ContactFields.role.nullable().optional(),
    phone: ContactFields.phone.nullable().optional(),
    email: ContactFields.email.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');

/**
 * `POST /v1/accounts/{id}/location-proposals`: where the field user stands, from a fix of 50 m or
 * better taken within two minutes before they proposed it (M4). Both times are the phone's, so a
 * proposal made offline counts when it arrives.
 */
export const CreateLocationProposalBody = z.strictObject({
  id: z.uuid(),
  lat: GeoPoint.shape.lat,
  lng: GeoPoint.shape.lng,
  accuracy: z.number().min(0).max(10_000),
  capturedAt: z.iso.datetime({ offset: true }),
  proposedAt: z.iso.datetime({ offset: true }),
});

export const LocationProposalResult = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    point: GeoPoint,
    accuracy: z.number(),
    capturedAt: z.iso.datetime(),
    status: ProposalStatus,
    proposedBy: Ref,
    approvalId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'LocationProposal' });

/** Who filled a slot over a stretch of days; `validTo` is the first day they no longer did. */
export const SlotHistoryEntry = z.object({
  slot: Key,
  user: Ref,
  validFrom: CalendarDate,
  validTo: CalendarDate.nullable(),
});

/**
 * `GET /v1/accounts/{id}/overview` (M4): the account and what surrounds it. Visits, submissions,
 * plan items, orders and finance join as their modules arrive.
 */
export const AccountOverview = z.object({
  account: AccountResult,
  contacts: z.array(ContactResult),
  assignments: z.array(SlotHistoryEntry),
  locationProposals: z.array(LocationProposalResult),
  /** The pending approval of a proposed account, when it waits for one. */
  approvalId: z.uuid().nullable(),
});

export type AccountStatus = z.infer<typeof AccountStatus>;
export type LocationStatus = z.infer<typeof LocationStatus>;
export type ProposalStatus = z.infer<typeof ProposalStatus>;
export type AccountAddress = z.infer<typeof AccountAddress>;
export type AccountSlotHolder = z.infer<typeof AccountSlotHolder>;
export type AccountResult = z.infer<typeof AccountResult>;
export type AccountListQuery = z.output<typeof AccountListQuery>;
export type AccountListResult = z.infer<typeof AccountListResult>;
export type SlotChanges = z.output<typeof SlotChanges>;
export type CreateAccountBody = z.output<typeof CreateAccountBody>;
export type UpdateAccountBody = z.output<typeof UpdateAccountBody>;
export type ContactResult = z.infer<typeof ContactResult>;
export type CreateContactBody = z.output<typeof CreateContactBody>;
export type UpdateContactBody = z.output<typeof UpdateContactBody>;
export type CreateLocationProposalBody = z.output<typeof CreateLocationProposalBody>;
export type LocationProposalResult = z.infer<typeof LocationProposalResult>;
export type SlotHistoryEntry = z.infer<typeof SlotHistoryEntry>;
export type AccountOverview = z.infer<typeof AccountOverview>;
