import { z } from 'zod';
import { DataScope, Permission } from './common';
import { PhoneInput } from './auth';
import { Key, LocalizedNoun, LocalizedText } from './config';

/**
 * People and access in a tenant (spec 4.2, 5.3, module M3, spec 11.2 People group). Roles and
 * designations are configuration: templates define them, tenants add their own, and everything
 * else refers to them by key.
 */

/** A role: permissions from spec Appendix E, and whose records they reach (spec 4.2). */
export const RoleDefinition = z
  .strictObject({
    key: Key,
    name: LocalizedText,
    scope: DataScope,
    permissions: z.array(Permission).min(1),
    mobileOnly: z.boolean().default(false).meta({
      description: 'Its users may use the mobile app only; the web answers USE_MOBILE_APP (M1)',
    }),
  })
  .meta({ id: 'Role' });

/** A job title with a level, 1 being the highest. It grants no permissions (spec 4.2). */
export const DesignationDefinition = z
  .strictObject({
    key: Key,
    name: LocalizedNoun,
    level: z.int().min(1).max(10),
    defaultRole: Key.meta({ description: 'The role new users with this designation get' }),
    canHaveReports: z.boolean(),
    ranked: z.boolean().default(false).meta({
      description: 'Whether people with it appear in rankings, one group per designation (D8)',
    }),
  })
  .meta({ id: 'Designation' });

export const RoleResult = RoleDefinition.extend({
  id: z.uuid(),
  mobileOnly: z.boolean(),
  /** One of the six roles every tenant starts with (spec 4.2). */
  system: z.boolean(),
});

export const DesignationResult = DesignationDefinition.extend({
  id: z.uuid(),
  ranked: z.boolean(),
});

export const CreateRoleBody = RoleDefinition;

export const UpdateRoleBody = z
  .strictObject({
    name: LocalizedText.optional(),
    scope: DataScope.optional(),
    permissions: z.array(Permission).min(1).optional(),
    mobileOnly: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');

export const CreateDesignationBody = DesignationDefinition;

export const UpdateDesignationBody = z
  .strictObject({
    name: LocalizedNoun.optional(),
    level: z.int().min(1).max(10).optional(),
    defaultRole: Key.optional(),
    canHaveReports: z.boolean().optional(),
    ranked: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');

export const USER_STATUSES = ['active', 'inactive'] as const;
export const UserStatus = z.enum(USER_STATUSES);

/** An employee code: unique in the tenant, and the key imports match users by (Appendix B.1). */
export const UserCode = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/,
    'Use up to 40 letters, digits, dots, dashes, slashes or underscores',
  );

const PersonName = z.string().trim().min(2).max(100);
const Email = z.email().max(254);
const CalendarDate = z.iso.date();

/** Values of the tenant's custom user fields, by field key (spec 5.3). */
const CustomValues = z.record(Key, z.unknown()).meta({
  description:
    "Values of the tenant's custom user fields, by key, checked against their definitions",
});

export const CreateUserBody = z.strictObject({
  code: UserCode,
  name: PersonName,
  phone: PhoneInput.optional().meta({
    description: 'Needed to sign in (D11). Unique in the tenant.',
  }),
  email: Email.optional(),
  designation: Key,
  role: Key.optional().meta({ description: "Leave out for the designation's default role" }),
  managerId: z.uuid().nullable().default(null),
  joiningDate: CalendarDate.optional(),
  exitDate: CalendarDate.optional(),
  territoryIds: z.array(z.uuid()).max(20).default([]).meta({
    description: 'The territories the user works in, from today (spec 5.4)',
  }),
  custom: CustomValues.default({}),
});

/** Send only what changes; `null` clears an optional field. */
export const UpdateUserBody = z
  .strictObject({
    code: UserCode.optional(),
    name: PersonName.optional(),
    phone: PhoneInput.nullable().optional(),
    email: Email.nullable().optional(),
    designation: Key.optional(),
    role: Key.optional(),
    managerId: z.uuid().nullable().optional(),
    joiningDate: CalendarDate.nullable().optional(),
    exitDate: CalendarDate.nullable().optional(),
    status: UserStatus.optional(),
    custom: z.record(Key, z.unknown().nullable()).optional().meta({
      description: 'Custom values to change, by key; `null` clears one. Others stay as they are.',
    }),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');

/** A territory a user is attached to today. */
export const TerritoryRef = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

export const UserResult = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  designation: Key,
  role: Key,
  managerId: z.uuid().nullable(),
  joiningDate: CalendarDate.nullable(),
  exitDate: CalendarDate.nullable(),
  status: UserStatus,
  /** The manager's code and name, for tables and headings. */
  manager: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
  territories: z.array(TerritoryRef),
  custom: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const PermissionState = z.enum(['granted', 'denied', 'undetermined']);

/**
 * `POST /v1/devices/heartbeat`: the phone's health (spec 12.1, M3), sent when the app starts and
 * every 15 minutes on duty. A permission or setting the app can't read yet is left out.
 */
export const DeviceHeartbeatBody = z.strictObject({
  appVersion: z.string().trim().min(1).max(32),
  osVersion: z.string().trim().min(1).max(32),
  model: z.string().trim().min(1).max(100).optional(),
  permissions: z
    .strictObject({
      backgroundLocation: PermissionState.optional(),
      notifications: PermissionState.optional(),
      camera: PermissionState.optional(),
    })
    .default({}),
  /** Whether the phone's battery optimisation may stop the app in the background. */
  batteryOptimised: z.boolean().optional(),
  queue: z.strictObject({
    queued: z.int().min(0),
    parked: z.int().min(0),
    oldestQueuedAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  lastSyncAt: z.iso.datetime({ offset: true }).nullable(),
});

/** What the cell keeps of a heartbeat in `devices.health`, with when it arrived. */
export const DeviceHealth = DeviceHeartbeatBody.extend({
  receivedAt: z.iso.datetime(),
  /** Device time minus server time when it arrived, from `X-Device-Time` (BR-44). */
  clockSkewSeconds: z.int().nullable(),
}).meta({ id: 'DeviceHealth' });

/** The phone a user is bound to, and its last heartbeat (M3). */
export const DeviceSummary = z
  .object({
    id: z.uuid(),
    platform: z.enum(['android', 'ios', 'web']),
    model: z.string().nullable(),
    osVersion: z.string().nullable(),
    appVersion: z.string().nullable(),
    boundAt: z.iso.datetime().nullable(),
    lastSeenAt: z.iso.datetime().nullable(),
    health: DeviceHealth.nullable(),
  })
  .meta({ id: 'DeviceSummary' });

/** A user as the people screens show them: with the phone they are bound to, if any. */
export const UserView = UserResult.extend({ device: DeviceSummary.nullable() }).meta({
  id: 'UserView',
});

/** `GET /v1/users`: the users the caller's scope reaches, oldest first, a page at a time. */
export const UserListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.uuid().optional(),
  status: UserStatus.optional(),
  q: z.string().trim().min(1).max(100).optional().meta({
    description: 'Part of a name, code or mobile number',
  }),
  designation: Key.optional(),
  managerId: z.uuid().optional().meta({ description: "Only this person's direct reports" }),
});

export const UserListResult = z.object({
  items: z.array(UserView),
  nextCursor: z.uuid().nullable(),
});

/** `GET /v1/users/{id}/history`: what changed about a person, newest first. */
export const UserHistoryQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

export const TRANSFER_STATUSES = ['scheduled', 'applied', 'cancelled', 'failed'] as const;
export const TransferStatus = z.enum(TRANSFER_STATUSES);

const transferChanges = {
  managerId: z.uuid().nullable().optional().meta({ description: '`null` puts them at the top' }),
  designation: Key.optional(),
  role: Key.optional(),
  territoryIds: z.array(z.uuid()).max(20).optional().meta({
    description: 'The territories they work in from the date on, replacing the ones before',
  }),
};

const someChange = (changes: Record<string, unknown>) =>
  ['managerId', 'designation', 'role', 'territoryIds'].some((key) => changes[key] !== undefined);

/**
 * `POST /v1/users/{id}/transfers` (M3): a move to another manager, designation, role or
 * territories from a date on. Today's applies at once; a later date's waits for that day.
 */
export const CreateTransferBody = z
  .strictObject({
    effectiveDate: CalendarDate.meta({ description: "The first day, on the tenant's calendar" }),
    ...transferChanges,
  })
  .refine(someChange, 'Choose something to change');

export const TransferResult = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    effectiveDate: CalendarDate,
    changes: z.strictObject(transferChanges),
    status: TransferStatus,
    /** Why a transfer could not be applied on its day. */
    reason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    createdBy: z.uuid().nullable(),
    appliedAt: z.iso.datetime().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Transfer' });

export const TransferListResult = z.object({ items: z.array(TransferResult) });

export const TransferParams = z.strictObject({ id: z.uuid(), transferId: z.uuid() });

/** `GET /v1/org-chart`: one level of the reporting tree, with team counts (M3). */
export const OrgChartQuery = z.strictObject({
  managerId: z.uuid().optional().meta({
    description: "Whose direct reports to list. Leave out for the top of the caller's reach.",
  }),
});

export const OrgChartNode = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    designation: Key,
    status: UserStatus,
    managerId: z.uuid().nullable(),
    /** Direct reports the caller reaches. */
    reports: z.int(),
    /** Everyone below, by designation key. */
    team: z.record(z.string(), z.int()),
  })
  .meta({ id: 'OrgChartNode' });

export const OrgChartResult = z.object({
  items: z.array(OrgChartNode),
  /** Active people below `managerId`, or across the caller's reach, by designation key. */
  totals: z.record(z.string(), z.int()),
});

export const RoleListResult = z.object({ items: z.array(RoleResult) });

export const DesignationListResult = z.object({ items: z.array(DesignationResult) });

/** `GET /v1/me`: who is signed in, and what they may do. */
export const MeResult = z.object({
  userId: z.uuid(),
  tenantId: z.uuid(),
  cell: z.string(),
  code: z.string(),
  name: z.string(),
  designation: Key,
  role: Key,
  scope: DataScope,
  permissions: z.array(Permission),
  /** The bound phone this session runs on; web sessions have none (M1, rule 5). */
  deviceId: z.uuid().nullable(),
});

export type RoleDefinition = z.output<typeof RoleDefinition>;
export type DesignationDefinition = z.output<typeof DesignationDefinition>;
export type RoleResult = z.infer<typeof RoleResult>;
export type DesignationResult = z.infer<typeof DesignationResult>;
export type UpdateRoleBody = z.infer<typeof UpdateRoleBody>;
export type UpdateDesignationBody = z.infer<typeof UpdateDesignationBody>;
export type UserStatus = z.infer<typeof UserStatus>;
export type CreateUserBody = z.output<typeof CreateUserBody>;
export type UpdateUserBody = z.infer<typeof UpdateUserBody>;
export type UserResult = z.infer<typeof UserResult>;
export type TerritoryRef = z.infer<typeof TerritoryRef>;
export type DeviceHeartbeatBody = z.output<typeof DeviceHeartbeatBody>;
export type DeviceHealth = z.infer<typeof DeviceHealth>;
export type DeviceSummary = z.infer<typeof DeviceSummary>;
export type UserView = z.infer<typeof UserView>;
export type UserHistoryQuery = z.output<typeof UserHistoryQuery>;
export type TransferStatus = z.infer<typeof TransferStatus>;
export type CreateTransferBody = z.output<typeof CreateTransferBody>;
export type TransferResult = z.infer<typeof TransferResult>;
export type TransferListResult = z.infer<typeof TransferListResult>;
export type OrgChartQuery = z.output<typeof OrgChartQuery>;
export type OrgChartNode = z.infer<typeof OrgChartNode>;
export type OrgChartResult = z.infer<typeof OrgChartResult>;
export type UserListQuery = z.output<typeof UserListQuery>;
export type UserListResult = z.infer<typeof UserListResult>;
export type RoleListResult = z.infer<typeof RoleListResult>;
export type DesignationListResult = z.infer<typeof DesignationListResult>;
export type MeResult = z.infer<typeof MeResult>;
