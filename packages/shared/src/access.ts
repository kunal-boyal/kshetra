/**
 * The permission catalogue of spec Appendix E, grouped by its areas. A role holds a list of these,
 * and the role's data scope decides whose records each one reaches (spec 4.2). Stored roles refer
 * to permissions by name, so add new ones and never rename old ones.
 */
export const PERMISSIONS_BY_AREA = {
  field: [
    'shift.use',
    'tracking.pause',
    'visit.use',
    'submission.create',
    'account.propose',
    'account.propose_location',
  ],
  review: ['submission.review', 'submission.review_bulk', 'review_rules.manage'],
  planning: [
    'target.view',
    'target.edit',
    'target.lock',
    'target.unlock',
    'route.manage',
    'plan_item.manage',
    'account_plan.manage',
  ],
  performance: ['performance.view_team', 'leaderboard.view'],
  maps: ['live_map.view', 'trail.view'],
  people: [
    'user.view',
    'user.manage',
    'user.reset_device',
    'user.sign_out_all',
    'role.manage',
    'designation.manage',
  ],
  territories_and_accounts: [
    'territory.manage',
    'account.view',
    'account.manage',
    'account.import',
    'account.approve',
  ],
  configuration: [
    'settings.manage',
    'terminology.manage',
    'form.manage',
    'metric.manage',
    'workflow.manage',
    'policy.manage',
    'notification_template.manage',
    'module.manage',
  ],
  catalogue_and_orders: [
    'catalogue.manage',
    'price_list.manage',
    'order.create',
    'order.create_without_shift',
    'order.view',
    'order.decide',
    'order.line_decide',
    'order.fulfil',
  ],
  finance: ['finance.view', 'finance.manage'],
  people_operations: [
    'leave.request',
    'regularisation.request',
    'expense.claim',
    'approval.act',
    'calendar.manage',
    'leave_type.manage',
    'expense_policy.manage',
    'expense.mark_paid',
    'payroll.manage',
    'payslip.view',
  ],
  data: ['report.view', 'export.create', 'import.run', 'audit.view'],
  integrations_and_billing: ['api_client.manage', 'webhook.manage', 'billing.manage'],
} as const;

export type PermissionArea = keyof typeof PERMISSIONS_BY_AREA;
export type TenantPermission = (typeof PERMISSIONS_BY_AREA)[PermissionArea][number];

/** Every permission a tenant role can hold. */
export const TENANT_PERMISSIONS: readonly TenantPermission[] =
  Object.values(PERMISSIONS_BY_AREA).flat();

/** Permissions for vendor staff in the platform console (module M22). No tenant role holds them. */
export const PLATFORM_PERMISSIONS = [
  'platform.tenant.manage',
  'platform.plan.manage',
  'platform.support.request',
  'platform.support.approve_emergency',
  'platform.flags.manage',
  'platform.billing.manage',
  'platform.staff.manage',
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

/**
 * The vendor's staff roles (spec 4.1, decision D88): what each may do in the console. A platform
 * admin does everything, including inviting staff; the others hold their part of the work.
 */
export const PLATFORM_ROLES = ['platform_admin', 'implementation', 'support', 'finance'] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  platform_admin: PLATFORM_PERMISSIONS,
  implementation: ['platform.tenant.manage', 'platform.flags.manage'],
  support: ['platform.support.request'],
  finance: ['platform.plan.manage', 'platform.billing.manage'],
};

/**
 * Whose records a role reaches (spec 4.2): the user's own, their team at any depth, everything in
 * their territories, the union of those two, or the whole tenant.
 */
export const DATA_SCOPES = ['self', 'team', 'territory', 'team_or_territory', 'tenant'] as const;

export type DataScope = (typeof DATA_SCOPES)[number];

/** The roles every tenant starts with (spec 4.2). Templates set their names and permissions. */
export const SYSTEM_ROLES = [
  'tenant_admin',
  'business_head',
  'manager',
  'field_user',
  'back_office',
  'viewer',
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

/**
 * What each scope reaches, as the scopes it contains. Every scope reaches the user's own records,
 * `team_or_territory` reaches both halves, and `tenant` reaches everything.
 */
const CONTAINS: Readonly<Record<DataScope, readonly DataScope[]>> = {
  self: ['self'],
  team: ['self', 'team'],
  territory: ['self', 'territory'],
  team_or_territory: ['self', 'team', 'territory', 'team_or_territory'],
  tenant: DATA_SCOPES,
};

/** True when `outer` reaches at least every record `inner` reaches. */
export function scopeContains(outer: DataScope, inner: DataScope): boolean {
  return CONTAINS[outer].includes(inner);
}

/**
 * Whether someone may give a role to a user, or define or change one: only when the role holds no
 * permission they lack and reaches no further than they do. Without this rule, anyone who manages
 * users or roles could raise their own access through a second account or through a role.
 */
export function canGrant(
  actor: { permissions: Iterable<string>; scope: DataScope },
  role: { permissions: Iterable<string>; scope: DataScope },
): boolean {
  const held = new Set(actor.permissions);
  for (const permission of role.permissions) {
    if (!held.has(permission)) return false;
  }
  return scopeContains(actor.scope, role.scope);
}
