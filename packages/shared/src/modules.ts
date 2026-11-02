import type { TenantPermission } from './access';

/**
 * Modules (spec 5.13, decision D64). The plan decides which a tenant may use; within those, its
 * admin may switch modules off. Core never switches off. Switching one off hides its screens,
 * removes its permissions from every role's effective set, and makes its routes answer
 * `MODULE_DISABLED` (M2).
 */
export const MODULE_KEYS = [
  'core',
  'leave_attendance',
  'orders',
  'account_finance',
  'expenses',
  'payroll_inputs',
  'statutory_payroll',
  'integrations',
  'sso',
  'advanced_analytics',
  'inventory',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** The modules a tenant admin may switch off. */
export const SWITCHABLE_MODULES = MODULE_KEYS.filter(
  (key): key is Exclude<ModuleKey, 'core'> => key !== 'core',
);
export type SwitchableModule = (typeof SWITCHABLE_MODULES)[number];

/**
 * Modules with something to switch in this release (decision D125); a module still to be built
 * shows as arriving later (spec 15).
 */
export const AVAILABLE_MODULES: readonly ModuleKey[] = [
  'core',
  'leave_attendance',
  'orders',
  'account_finance',
  'expenses',
  'payroll_inputs',
  'statutory_payroll',
  'integrations',
  'sso',
  'advanced_analytics',
  'inventory',
];

/**
 * Modules that stay off until a tenant's admin switches them on (decisions D128 and D130):
 * statutory payroll ships off, as an add-on awaiting a chartered accountant's review, and
 * inventory, as an add-on that makes fulfilment move distributors' stock.
 */
export const OPT_IN_MODULES: readonly SwitchableModule[] = ['statutory_payroll', 'inventory'];

/**
 * The permissions each module brings. Anything not listed is Core's: the catalogue stays there, as
 * phase 1 forms offer its items.
 */
export const MODULE_PERMISSIONS: Record<SwitchableModule, readonly TenantPermission[]> = {
  leave_attendance: [
    'leave.request',
    'regularisation.request',
    'calendar.manage',
    'leave_type.manage',
  ],
  orders: [
    'price_list.manage',
    'order.create',
    'order.create_without_shift',
    'order.view',
    'order.decide',
    'order.line_decide',
    'order.fulfil',
    'scheme.manage',
  ],
  account_finance: ['finance.view', 'finance.manage'],
  expenses: ['expense.claim', 'expense_policy.manage', 'expense.mark_paid'],
  payroll_inputs: ['payroll.manage', 'payslip.view'],
  statutory_payroll: ['payroll.run', 'salary.manage'],
  integrations: ['api_client.manage', 'webhook.manage', 'erp.manage'],
  sso: [],
  advanced_analytics: ['report.schedule', 'dashboard.manage'],
  inventory: ['stock.view', 'stock.record', 'stock.count'],
};

/**
 * Permissions that stay while another module is open too: a person's own payslip is the estimate's
 * (payroll inputs) or the statutory one's, whichever the organisation uses (decision D128).
 */
export const ALSO_IN_MODULES: Partial<Record<TenantPermission, readonly SwitchableModule[]>> = {
  'payslip.view': ['statutory_payroll'],
};

/** Whether switched-off modules take a permission away: its own module and any it shares are off. */
export function permissionClosed(
  permission: TenantPermission,
  off: readonly string[] | ReadonlySet<string>,
): boolean {
  const closed = off instanceof Set ? off : new Set(off as readonly string[]);
  const owner = moduleOf(permission);
  if (owner === 'core' || !closed.has(owner)) return false;
  return (ALSO_IN_MODULES[permission] ?? []).every((module) => closed.has(module));
}

/** The module a permission belongs to. */
export function moduleOf(permission: TenantPermission): ModuleKey {
  for (const module of SWITCHABLE_MODULES) {
    if (MODULE_PERMISSIONS[module].includes(permission)) return module;
  }
  return 'core';
}

/** A role's permissions with those of switched-off modules taken away. */
export function effectivePermissions(
  permissions: Iterable<TenantPermission>,
  off: readonly SwitchableModule[],
): Set<TenantPermission> {
  const closed = new Set<string>(off);
  return new Set([...permissions].filter((permission) => !permissionClosed(permission, closed)));
}

/**
 * Whether a route needing these permissions is closed by switched-off modules: every one belongs
 * to a module that is off, so the answer is `MODULE_DISABLED` rather than `FORBIDDEN`.
 */
export function closedByModules(
  required: readonly TenantPermission[],
  off: readonly SwitchableModule[],
): boolean {
  return required.length > 0 && required.every((permission) => permissionClosed(permission, off));
}
