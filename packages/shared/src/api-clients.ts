import type { TenantPermission } from './access';

/**
 * API clients (module M20, decision D94): a tenant's systems, such as an ERP, calling the same
 * `/v1` API the apps use, with OAuth 2.0 client credentials. A client holds scopes, read or write
 * per resource, each standing for the permissions its routes need; it reaches the whole tenant,
 * as no person's data scope limits it.
 */

export const API_SCOPES = {
  /** People, the org chart and people's histories. */
  'people:read': ['user.view'],
  'people:write': ['user.view', 'user.manage'],
  /** The territory tree; anyone with a scope reads it. */
  'territories:write': ['territory.manage'],
  'accounts:read': ['account.view'],
  'accounts:write': ['account.view', 'account.manage', 'account.import'],
  /** Items and price lists; reading the catalogue needs only `catalogue:read`. */
  'catalogue:read': [],
  'catalogue:write': ['catalogue.manage', 'price_list.manage'],
  'orders:read': ['order.view'],
  /** Deliveries recorded from the ERP. */
  'orders:write': ['order.view', 'order.fulfil'],
  /** Submissions are read by the people or accounts they belong to, so this reads both too. */
  'submissions:read': ['user.view', 'account.view'],
  /** Attendance days and shifts are read by person, so this reads people too. */
  'attendance:read': ['user.view'],
  'finance:read': ['finance.view'],
  'finance:write': ['finance.view', 'finance.manage'],
  'targets:read': ['target.view'],
  'targets:write': ['target.view', 'target.edit'],
  /** External metric values, such as secondary sales from an ERP. */
  'metrics:write': ['metric.record'],
  'reports:read': ['report.view', 'export.create'],
  'audit:read': ['audit.view'],
} as const satisfies Record<string, readonly TenantPermission[]>;

export type ApiScope = keyof typeof API_SCOPES;
export const API_SCOPE_KEYS = Object.keys(API_SCOPES) as [ApiScope, ...ApiScope[]];

/** The permissions a client's scopes stand for. */
export function scopePermissions(scopes: readonly ApiScope[]): TenantPermission[] {
  return [...new Set(scopes.flatMap((scope) => API_SCOPES[scope] as readonly TenantPermission[]))];
}

/** The role key an API client shows; no tenant's role may take it. */
export const API_CLIENT_ROLE_KEY = 'api_client';

/** How long a client's access token lasts; it asks for another with its credentials. */
export const API_TOKEN_SECONDS = 3600;

/** Requests a minute a client may make when its plan says nothing (spec M20). */
export const API_DEFAULT_PER_MINUTE = 300;

/**
 * A client ID names its tenant, so the token endpoint knows where to check the secret without
 * a lookup across every tenant: the tenant's ID without dashes, a dot, and a random part.
 */
export function apiClientId(tenantId: string, random: string): string {
  return `${tenantId.replace(/-/g, '')}.${random}`;
}

/** The tenant a client ID names, or null when it isn't one. */
export function tenantOfClientId(clientId: string): string | null {
  const match = /^([0-9a-f]{32})\.[A-Za-z0-9_-]{16,64}$/.exec(clientId);
  if (!match) return null;
  const hex = match[1]!;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
