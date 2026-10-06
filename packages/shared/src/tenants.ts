/** A tenant's life cycle (spec 10.3, module M23). */
export const TENANT_STATUSES = [
  'trial',
  'active',
  'grace',
  'read_only',
  'suspended',
  'terminated',
] as const;

export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** The states whose users may sign in and use the product. Suspended and terminated tenants are closed. */
export const OPEN_TENANT_STATUSES = [
  'trial',
  'active',
  'grace',
  'read_only',
] as const satisfies readonly TenantStatus[];

export function isOpenTenant(status: TenantStatus): boolean {
  return (OPEN_TENANT_STATUSES as readonly TenantStatus[]).includes(status);
}
