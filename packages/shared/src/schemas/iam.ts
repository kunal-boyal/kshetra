import { z } from 'zod';
import { DATA_SCOPES, TENANT_PERMISSIONS } from '../access';
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
    scope: z.enum(DATA_SCOPES),
    permissions: z.array(z.enum(TENANT_PERMISSIONS)).min(1),
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
    scope: z.enum(DATA_SCOPES).optional(),
    permissions: z.array(z.enum(TENANT_PERMISSIONS)).min(1).optional(),
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
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');

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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** `GET /v1/users`: the users the caller's scope reaches, oldest first, a page at a time. */
export const UserListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.uuid().optional(),
  status: UserStatus.optional(),
});

export const UserListResult = z.object({
  items: z.array(UserResult),
  nextCursor: z.uuid().nullable(),
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
  scope: z.enum(DATA_SCOPES),
  permissions: z.array(z.enum(TENANT_PERMISSIONS)),
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
export type UserListQuery = z.output<typeof UserListQuery>;
export type UserListResult = z.infer<typeof UserListResult>;
export type RoleListResult = z.infer<typeof RoleListResult>;
export type DesignationListResult = z.infer<typeof DesignationListResult>;
export type MeResult = z.infer<typeof MeResult>;
