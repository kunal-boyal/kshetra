import { MODULE_KEYS, PLATFORM_ROLES, TENANT_STATUSES } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { directory } from './common';

/**
 * The directory plane (spec 9.3, 10.3): which cell serves each tenant, who can sign in, and their
 * one-time codes and refresh tokens. Global, so these tables carry no tenant isolation; only the
 * directory module, as `directory_app`, may reach them (decision D23).
 */

export const cellKind = directory.enum('cell_kind', ['shared', 'dedicated']);

export const tenantStatus = directory.enum('tenant_status', TENANT_STATUSES);

export const membershipStatus = directory.enum('membership_status', ['active', 'inactive']);

/** How a code was sent. `none` marks a decoy for a number nobody uses: nothing is sent (M1, rule 2). */
export const otpChannel = directory.enum('otp_channel', [
  'sms',
  'whatsapp',
  'email',
  'none',
  'demo',
]);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** One complete data-plane deployment. Its `name` is the deployment's `CELL_ID`. */
export const cells = directory.table('cells', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  region: text('region').notNull(),
  apiBaseUrl: text('api_base_url').notNull(),
  kind: cellKind('kind').notNull().default('shared'),
  status: text('status').notNull().default('active'),
  capacityUsers: integer('capacity_users').notNull(),
});

export const tenants = directory.table('tenants', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: tenantStatus('status').notNull().default('trial'),
  cellId: uuid('cell_id')
    .notNull()
    .references(() => cells.id),
  // The tenant's plan (module M23, decision D89); none leaves every module open.
  planId: uuid('plan_id').references((): AnyPgColumn => plans.id),
  templateKey: text('template_key').notNull(),
  templateVersion: integer('template_version').notNull(),
  /**
   * A tenant for showing the product (decision D70): its people may sign in with the fixed codes
   * in `DEMO_CODES`. Set only at provisioning, from the command line.
   */
  demo: boolean('demo').notNull().default(false),
  // When a tenant on trial stops being one; billing decides what follows (module M23).
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** A person who signs in: a phone number, and optionally an email (D5). */
export const identities = directory.table('identities', {
  id: uuid('id').primaryKey(),
  phoneE164: text('phone_e164').notNull().unique(),
  email: text('email').unique(),
  createdAt: createdAt(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

/**
 * An identity's place in one tenant: the user it is there, whether they may sign in, and their
 * auth revision (BR-39). The tenant's cell owns these facts and sends them here whenever they
 * change; a membership belongs to one user for good, and moves to another identity when that
 * user's phone number changes.
 */
export const memberships = directory.table(
  'memberships',
  {
    id: uuid('id').primaryKey(),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => identities.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id').notNull(),
    status: membershipStatus('status').notNull().default('active'),
    authRevision: integer('auth_revision').notNull().default(0),
  },
  (table) => [
    uniqueIndex('memberships_tenant_user_key').on(table.tenantId, table.userId),
    // A phone number signs in to at most one user in each tenant.
    uniqueIndex('memberships_active_identity_tenant_key')
      .on(table.identityId, table.tenantId)
      .where(sql`${table.status} = 'active'`),
  ],
);

/** One code sent (or, for an unknown number, pretended). Only an HMAC of the code is kept. */
export const otpChallenges = directory.table(
  'otp_challenges',
  {
    id: uuid('id').primaryKey(),
    identityKey: text('identity_key').notNull(),
    codeHmac: text('code_hmac').notNull(),
    channel: otpChannel('channel').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (table) => [index('otp_challenges_identity_key_idx').on(table.identityKey, table.createdAt)],
);

/** A refresh token, kept only as a hash. Each sign-in starts a family; rotation stays inside it. */
export const refreshTokens = directory.table(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id),
    // The device joins with device binding; web sessions never have one.
    deviceId: uuid('device_id'),
    tokenHash: text('token_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(),
    authRevision: integer('auth_revision').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('refresh_tokens_family_idx').on(table.familyId)],
);

export const platformRole = directory.enum('platform_role', PLATFORM_ROLES);

export const platformUserStatus = directory.enum('platform_user_status', [
  'invited',
  'active',
  'disabled',
]);

/**
 * The vendor's staff (spec 4.1, module M22, decision D88). They are not tenant users: they sign in
 * to the console with an email, a password kept as a scrypt hash, and a TOTP code whose seed is
 * sealed with the column key. An invitation carries a one-time setup secret, kept as a hash.
 */
export const platformUsers = directory.table(
  'platform_users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: platformRole('role').notNull(),
    status: platformUserStatus('status').notNull().default('invited'),
    passwordHash: text('password_hash'),
    totpSecret: text('totp_secret'),
    totpConfirmedAt: timestamp('totp_confirmed_at', { withTimezone: true }),
    // The last 30-second step a code was used in, so no code works twice.
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    setupTokenHash: text('setup_token_hash').unique(),
    setupExpiresAt: timestamp('setup_expires_at', { withTimezone: true }),
    // Moves whenever the person's access changes, ending their sessions (as BR-39 does for users).
    authRevision: integer('auth_revision').notNull().default(0),
    failedSignIns: integer('failed_sign_ins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('platform_users_email_key').on(sql`lower(${table.email})`)],
);

/** A console refresh token, kept as a hash; rotation stays in its family, as for tenant users. */
export const platformSessions = directory.table(
  'platform_sessions',
  {
    id: uuid('id').primaryKey(),
    platformUserId: uuid('platform_user_id')
      .notNull()
      .references(() => platformUsers.id),
    tokenHash: text('token_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(),
    authRevision: integer('auth_revision').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('platform_sessions_family_idx').on(table.familyId)],
);

/**
 * What vendor staff did in the console (spec 13.2, M21): sign-ins, invitations, tenants created,
 * suspended and reactivated. Append-only; actions inside a tenant also reach its own audit log.
 */
export const platformAudit = directory.table(
  'platform_audit',
  {
    id: uuid('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    platformUserId: uuid('platform_user_id').references(() => platformUsers.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    detail: jsonb('detail').notNull().default({}),
    ip: text('ip'),
  },
  (table) => [index('platform_audit_target_idx').on(table.targetType, table.targetId, table.at)],
);

/**
 * What tenants buy (spec 5.13, module M23, decision D89): a price per seat, monthly or yearly, the
 * modules it opens, its limits and its add-ons. Plans are data: the console makes and changes
 * them, and a plan in use is switched off rather than removed.
 */
export const plans = directory.table('plans', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: jsonb('name').$type<{ en: string; hi: string }>().notNull(),
  priceMonth: numeric('price_month', { precision: 18, scale: 2 }).notNull(),
  priceYear: numeric('price_year', { precision: 18, scale: 2 }).notNull(),
  modules: text('modules').array().$type<(typeof MODULE_KEYS)[number][]>().notNull(),
  limits: jsonb('limits').$type<{ users: number | null; storageGb: number | null }>().notNull(),
  addons: jsonb('addons')
    .$type<{ key: string; name: { en: string; hi: string }; price: string }[]>()
    .notNull()
    .default([]),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** What a tenant has beyond its plan: modules added, and limits that differ from the plan's. */
export const tenantEntitlements = directory.table('tenant_entitlements', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  extraModules: text('extra_modules').array().$type<string[]>().notNull().default([]),
  limits: jsonb('limits')
    .$type<{ users?: number | null; storageGb?: number | null }>()
    .notNull()
    .default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A tenant's metered usage for one month (M22): kept current through the month, then final. */
export const usageRecords = directory.table(
  'usage_records',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    period: text('period').notNull(),
    metric: text('metric').notNull(),
    quantity: numeric('quantity', { precision: 24, scale: 4 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.period, table.metric] })],
);
