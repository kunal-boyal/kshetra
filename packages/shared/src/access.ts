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
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

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
