import { TENANT_STATUSES } from '@kshetra/shared';
import { sql } from 'drizzle-orm';
import { index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
export const otpChannel = directory.enum('otp_channel', ['sms', 'whatsapp', 'email', 'none']);

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
  // Plans arrive with billing (module M23).
  planId: uuid('plan_id'),
  templateKey: text('template_key').notNull(),
  templateVersion: integer('template_version').notNull(),
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
