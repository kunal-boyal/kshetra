import {
  ANNOUNCEMENT_TONES,
  type CellFiguresShape,
  MODULE_KEYS,
  type PlanLimitValues,
  PLATFORM_ROLES,
  SUPPORT_SCOPES,
  TENANT_STATUSES,
} from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  bigint,
  boolean,
  check,
  date,
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
  /**
   * The cell the tenant is being moved to (decision D95). While it is set the tenant reads and its
   * writes wait; switching to that cell clears it.
   */
  movingToCellId: uuid('moving_to_cell_id').references(() => cells.id),
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
  /**
   * When it was terminated (decision D95): its data is deleted 30 days later, when `deleted_at` is
   * set. The row stays, as its invoices must.
   */
  terminatedAt: timestamp('terminated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
    // And to one organisation in all (decision D103).
    uniqueIndex('memberships_one_active_organisation')
      .on(table.identityId)
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
    // A member's session; null for vendor support under a grant (decision D93).
    membershipId: uuid('membership_id').references(() => memberships.id),
    supportGrantId: uuid('support_grant_id').references((): AnyPgColumn => supportGrants.id),
    // The device joins with device binding; web sessions never have one.
    deviceId: uuid('device_id'),
    tokenHash: text('token_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(),
    authRevision: integer('auth_revision').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // The sign-in that started the family passed an authenticator code (decision D91), or the
    // identity provider said it did one (D101).
    secondFactor: boolean('second_factor').notNull().default(false),
    // When the family's sign-in was, which its absolute limit counts from, and whether it came
    // through the organisation's SSO, whose sessions are shorter (decision D101).
    familyStartedAt: timestamp('family_started_at', { withTimezone: true }).notNull().defaultNow(),
    sso: boolean('sso').notNull().default(false),
    // Where the token was issued, for the person's list of where they are signed in (decision
    // D101): the browser or app as it named itself, cut short, and the address.
    userAgent: text('user_agent'),
    ip: text('ip'),
    // When the session last gave a fresh authenticator code (step-up, decision D101); each
    // refresh carries it on, so changes needing one stay open for their ten minutes.
    steppedUpAt: timestamp('stepped_up_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('refresh_tokens_family_idx').on(table.familyId),
    // Who used the apps when: the console's activity and usage's active people.
    index('refresh_tokens_membership_created_idx').on(table.membershipId, table.createdAt),
    check(
      'refresh_tokens_one_holder',
      sql`(${table.membershipId} is null) <> (${table.supportGrantId} is null)`,
    ),
  ],
);

/**
 * A person's authenticator (spec 10.3, decision D91): the TOTP secret sealed under `COLUMN_KEY`,
 * when it was set up (null while being set up), the last step used, so no code works twice, and
 * the salted scrypt hashes of the unused recovery codes. One per person, whatever their tenants.
 */
export const totpSecrets = directory.table('totp_secrets', {
  identityId: uuid('identity_id')
    .primaryKey()
    .references(() => identities.id),
  secretSealed: text('secret_sealed').notNull(),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  lastStep: bigint('last_step', { mode: 'number' }),
  recoveryHashes: text('recovery_hashes').array().notNull().default([]),
  createdAt: createdAt(),
});

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

export const supportScope = directory.enum('support_scope', SUPPORT_SCOPES);

/**
 * Support access (spec 10.3, module M22, decision D93): a staff member asks to enter a tenant with
 * a reason, the scope and hours wanted, and whether it's an emergency. The tenant's admin, or for
 * an emergency a second vendor admin, approves it, which sets its start and end, or declines it.
 * Either side may end it early. Where it stands is `supportStatus()` of these columns.
 */
export const supportGrants = directory.table(
  'support_grants',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    platformUserId: uuid('platform_user_id')
      .notNull()
      .references(() => platformUsers.id),
    reason: text('reason').notNull(),
    scope: supportScope('scope').notNull(),
    hours: integer('hours').notNull(),
    emergency: boolean('emergency').notNull().default(false),
    grantedScope: supportScope('granted_scope'),
    // The tenant's admin who approved, or for an emergency the second vendor admin.
    approvedByUserId: uuid('approved_by_user_id'),
    approvedByStaffId: uuid('approved_by_staff_id').references(() => platformUsers.id),
    // Names as they were, since the directory can't read a tenant's people.
    approvedByName: text('approved_by_name'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // Who declined or ended it: someone at the tenant, or vendor staff.
    closedByUserId: uuid('closed_by_user_id'),
    closedByStaffId: uuid('closed_by_staff_id').references(() => platformUsers.id),
    closedByName: text('closed_by_name'),
    createdAt: createdAt(),
  },
  (table) => [
    index('support_grants_tenant_idx').on(table.tenantId, table.createdAt),
    index('support_grants_staff_idx').on(table.platformUserId, table.createdAt),
  ],
);

/**
 * Each cell's health, a minute at a time (module M22, spec 14.6, decision D93): what its scheduler
 * reported for the minute just gone. Kept two days; the console shows the latest and the last day.
 */
export const cellHealth = directory.table(
  'cell_health',
  {
    cellId: uuid('cell_id')
      .notNull()
      .references(() => cells.id),
    at: timestamp('at', { withTimezone: true }).notNull(),
    figures: jsonb('figures').$type<CellFiguresShape>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.cellId, table.at] })],
);

export const announcementTone = directory.enum('announcement_tone', ANNOUNCEMENT_TONES);

/**
 * What the vendor tells tenants (module M22, decision D93): a title and body in English and Hindi,
 * as information or a warning, on the web, the phone or both, to every tenant or those listed,
 * from its start to its end, unless withdrawn first.
 */
export const announcements = directory.table(
  'announcements',
  {
    id: uuid('id').primaryKey(),
    title: jsonb('title').$type<{ en: string; hi: string }>().notNull(),
    body: jsonb('body').$type<{ en: string; hi: string }>().notNull(),
    tone: announcementTone('tone').notNull(),
    surfaces: text('surfaces').array().notNull(),
    // Null for every tenant.
    tenantIds: uuid('tenant_ids').array(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => platformUsers.id),
    createdAt: createdAt(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnBy: uuid('withdrawn_by').references(() => platformUsers.id),
  },
  (table) => [index('announcements_ends_idx').on(table.endsAt)],
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
  // `apiPerMinute` came with API clients (decision D94), and the request, queue, import and export
  // limits with decision D98; plans made before have none of them.
  limits: jsonb('limits')
    .$type<{ users: number | null; storageGb: number | null } & Partial<PlanLimitValues>>()
    .notNull(),
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
  limits: jsonb('limits').$type<Partial<PlanLimitValues>>().notNull().default({}),
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

/**
 * Settings of the platform itself, by key (decision D90): `billing` holds the seller's details
 * and the dunning periods. Defaults apply until a row is written.
 */
export const platformSettings = directory.table('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

/** How a tenant pays automatically: none until set up, then active, or failed after a refusal. */
export const mandateStatus = directory.enum('mandate_status', [
  'none',
  'pending',
  'active',
  'failed',
]);

/** The tenant as the buyer on its invoices (module M23, decision D90). */
export const billingAccounts = directory.table('billing_accounts', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  legalName: text('legal_name').notNull(),
  gstin: text('gstin'),
  address: text('address').notNull(),
  // The place of supply: the GST state code, such as 27 for Maharashtra.
  stateCode: text('state_code').notNull(),
  email: text('email').notNull(),
  language: text('language').notNull().default('en'),
  mandateStatus: mandateStatus('mandate_status').notNull().default('none'),
  mandateRef: text('mandate_ref'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const billingCycle = directory.enum('billing_cycle', ['month', 'year']);
export const subscriptionStatus = directory.enum('subscription_status', ['active', 'cancelled']);

/**
 * A tenant's subscription (spec 10.3): its plan, monthly or annual, the seats an annual one
 * commits to (raised by each true-up), and its current term. One active subscription a tenant.
 */
export const subscriptions = directory.table(
  'subscriptions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    cycle: billingCycle('cycle').notNull(),
    committedSeats: integer('committed_seats'),
    status: subscriptionStatus('status').notNull().default('active'),
    startedOn: date('started_on', { mode: 'string' }).notNull(),
    termStart: date('term_start', { mode: 'string' }),
    termEnd: date('term_end', { mode: 'string' }),
    endsOn: date('ends_on', { mode: 'string' }),
    // The dunning stage last applied to the tenant (BR-48), so a tenant moves only when it changes.
    dunningStage: text('dunning_stage'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('subscriptions_one_active')
      .on(table.tenantId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const invoiceKind = directory.enum('invoice_kind', ['monthly', 'annual', 'true_up']);
export const invoiceStatus = directory.enum('invoice_status', ['issued', 'paid']);

interface InvoiceParty {
  legalName: string;
  gstin: string | null;
  address: string;
  stateCode: string;
  stateName: string;
}

/**
 * The vendor's GST tax invoices (BR-47). Issued once and never changed: the seller and buyer are
 * copied in as they were, and the PDF is drawn from the row whenever it is asked for.
 */
export const invoices = directory.table(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id),
    number: text('number').notNull().unique(),
    kind: invoiceKind('kind').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    seller: jsonb('seller').$type<InvoiceParty & { email: string; sac: string }>().notNull(),
    buyer: jsonb('buyer').$type<InvoiceParty>().notNull(),
    lines: jsonb('lines')
      .$type<{ description: string; quantity: string; rate: string; amount: string }[]>()
      .notNull(),
    subtotal: numeric('subtotal', { precision: 18, scale: 2 }).notNull(),
    // The GST rate the invoice was issued at, in percent.
    gstRate: numeric('gst_rate', { precision: 7, scale: 4 }).notNull(),
    cgst: numeric('cgst', { precision: 18, scale: 2 }).notNull(),
    sgst: numeric('sgst', { precision: 18, scale: 2 }).notNull(),
    igst: numeric('igst', { precision: 18, scale: 2 }).notNull(),
    total: numeric('total', { precision: 18, scale: 2 }).notNull(),
    status: invoiceStatus('status').notNull().default('issued'),
    example: boolean('example').notNull().default(false),
    // When the gateway refused the charge; the invoice is overdue from that day (BR-48).
    chargeFailedAt: timestamp('charge_failed_at', { withTimezone: true }),
    providerRef: text('provider_ref'),
    createdAt: createdAt(),
  },
  (table) => [
    // The billing job issues each period's invoice once, however often it runs.
    uniqueIndex('invoices_once').on(table.subscriptionId, table.kind, table.periodFrom),
    index('invoices_tenant_idx').on(table.tenantId, table.issuedOn),
    index('invoices_status_idx').on(table.status, table.issuedOn),
  ],
);

/** The last number used in each invoice series, so numbers run without gaps (BR-47). */
export const invoiceSequences = directory.table('invoice_sequences', {
  series: text('series').primaryKey(),
  last: integer('last').notNull(),
});

export const paymentMethod = directory.enum('payment_method', [
  'mandate',
  'bank_transfer',
  'cheque',
  'upi',
  'other',
]);

/** Money received against an invoice, through the gateway or recorded by vendor finance. */
export const payments = directory.table(
  'payments',
  {
    id: uuid('id').primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    method: paymentMethod('method').notNull(),
    reference: text('reference'),
    receivedOn: date('received_on', { mode: 'string' }).notNull(),
    providerRef: text('provider_ref').unique(),
    recordedBy: uuid('recorded_by'),
    createdAt: createdAt(),
  },
  (table) => [index('payments_invoice_idx').on(table.invoiceId)],
);

/** Billing emails already sent, by tenant and key, so each goes once (BR-48). */
export const billingNotices = directory.table(
  'billing_notices',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    key: text('key').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.key] })],
);

export const ssoProtocol = directory.enum('sso_protocol', ['oidc', 'saml']);

/**
 * A tenant's single sign-on (spec 10.3, decision D91): one connection a tenant, its protocol
 * settings sealed under `COLUMN_KEY` (the OIDC client secret among them), the email domains it
 * signs in, whether it is on, and whether web users in those domains must use it.
 */
export const ssoConnections = directory.table('sso_connections', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  protocol: ssoProtocol('protocol').notNull(),
  configSealed: text('config_sealed').notNull(),
  domains: text('domains').array().notNull(),
  enabled: boolean('enabled').notNull().default(false),
  enforced: boolean('enforced').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The email domains an organisation's single sign-on claims, each proved by a DNS TXT record
 * holding its token (ASVS V6.8.1, decision D101): only a verified domain signs anyone in, and a
 * domain one organisation has verified can't be claimed by another.
 */
export const ssoDomains = directory.table(
  'sso_domains',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    domain: text('domain').notNull(),
    token: text('token').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.domain] }),
    uniqueIndex('sso_domains_verified')
      .on(table.domain)
      .where(sql`${table.verifiedAt} is not null`),
  ],
);

/**
 * Who a person is at the organisation's identity provider (ASVS V10.5.2, decision D101): the
 * provider's issuer and subject, bound to the member at their first SSO sign-in by email. After
 * that the subject decides, so an email changed or reused at the provider can't move them.
 */
export const ssoSubjects = directory.table(
  'sso_subjects',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.issuer, table.subject] }),
    uniqueIndex('sso_subjects_member').on(table.tenantId, table.issuer, table.membershipId),
  ],
);
