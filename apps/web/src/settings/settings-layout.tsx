import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { cn } from '@thelamp/ui-web';
import { useLanguage } from '../i18n';
import { useAccess } from '../people/data';

type Translate = ReturnType<typeof useLanguage>['t'];
type Access = ReturnType<typeof useAccess>;

interface Page {
  to: string;
  label: (t: Translate) => string;
  shown: (access: Access) => boolean;
}

const always = () => true;
const can =
  (...permissions: Parameters<Access['can']>[0][]) =>
  (access: Access) =>
    permissions.some((permission) => access.can(permission));

/**
 * Settings (spec 8.2, M2) in six groups (decision D104): the organisation, its rules, words,
 * modules and billing; people and access, with who approves each kind of request; field work's
 * forms, types, levels, metrics, calendars, leave and expenses; commerce's catalogue and price
 * lists; the organisation's data; and what developers connect with.
 */
export const SETTINGS_GROUPS = [
  {
    key: 'organisation',
    pages: [
      {
        to: '/settings/organisation',
        label: (t) => t('admin.organisation'),
        shown: can('settings.manage'),
      },
      { to: '/settings/rules', label: (t) => t('admin.rules'), shown: can('settings.manage') },
      {
        to: '/settings/terminology',
        label: (t) => t('admin.terminology'),
        shown: can('terminology.manage'),
      },
      {
        to: '/settings/modules',
        label: (t) => t('admin.modules'),
        shown: can('module.manage', 'settings.manage'),
      },
      { to: '/settings/billing', label: (t) => t('billing.title'), shown: can('billing.manage') },
    ],
  },
  {
    key: 'people',
    pages: [
      {
        to: '/settings/roles',
        label: (t) => t('nav.roles'),
        shown: can('role.manage', 'user.manage'),
      },
      { to: '/settings/designations', label: (t) => t('nav.designations'), shown: always },
      { to: '/settings/people-fields', label: (t) => t('nav.user_fields'), shown: always },
      {
        to: '/settings/approvals',
        label: (t) => t('nav.approval_chains'),
        shown: can('workflow.manage'),
      },
      {
        to: '/settings/security',
        label: (t) => t('security_data.title'),
        shown: can('settings.manage', 'audit.view'),
      },
      {
        to: '/settings/sso',
        label: (t) => t('sso.title'),
        shown: (access) => access.can('settings.manage') && !access.modulesOff.includes('sso'),
      },
      { to: '/settings/support', label: (t) => t('support.title'), shown: can('settings.manage') },
    ],
  },
  {
    key: 'field',
    pages: [
      { to: '/settings/forms', label: (t) => t('nav.forms'), shown: can('form.manage') },
      {
        to: '/settings/account-types',
        label: (t) => t('types.title'),
        shown: can('settings.manage'),
      },
      {
        to: '/settings/territory-levels',
        label: (t) => t('levels.title'),
        shown: can('territory.manage'),
      },
      { to: '/settings/metrics', label: (t) => t('metrics.title'), shown: can('metric.manage') },
      {
        to: '/settings/calendars',
        label: (t) => t('calendars.title'),
        shown: can('calendar.manage'),
      },
      {
        to: '/settings/leave-types',
        label: (t) => t('leave.types_title'),
        shown: can('leave_type.manage'),
      },
      {
        to: '/settings/expense-policies',
        label: (t) => t('policies.title'),
        shown: can('expense_policy.manage'),
      },
    ],
  },
  {
    key: 'commerce',
    pages: [
      {
        to: '/settings/catalogue',
        label: (t) => t('nav.catalogue'),
        shown: can('catalogue.manage'),
      },
      {
        to: '/settings/price-lists',
        label: (t) => t('prices.title'),
        shown: can('price_list.manage'),
      },
    ],
  },
  {
    key: 'data',
    pages: [
      {
        to: '/settings/configuration',
        label: (t) => t('config_file.title'),
        shown: can('settings.manage'),
      },
      {
        to: '/settings/data-export',
        label: (t) => t('data_export.title'),
        shown: can('settings.manage'),
      },
      {
        to: '/settings/data-requests',
        label: (t) => t('data_requests.title'),
        shown: can('settings.manage'),
      },
      { to: '/settings/audit-log', label: (t) => t('audit_log.title'), shown: can('audit.view') },
    ],
  },
  {
    key: 'developers',
    pages: [
      {
        to: '/settings/developers',
        label: (t) => t('developers.title'),
        shown: can('api_client.manage', 'webhook.manage'),
      },
    ],
  },
] as const satisfies readonly { key: string; pages: readonly Page[] }[];

type GroupKey = (typeof SETTINGS_GROUPS)[number]['key'];

/** Whether a path is a page or one beneath it, such as an account type's editor. */
const under = (path: string, to: string) => path === to || path.startsWith(`${to}/`);

/**
 * The settings' frame: the groups the caller may open as a row of tabs, then the current group's
 * pages, then the page.
 */
export function SettingsLayout() {
  const { t } = useLanguage();
  const access = useAccess();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const groups = SETTINGS_GROUPS.map((group) => ({
    key: group.key as GroupKey,
    pages: (group.pages as readonly Page[]).filter((page) => page.shown(access)),
  })).filter((group) => group.pages.length > 0);
  const current = groups.find((group) => group.pages.some((page) => under(path, page.to)));
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('nav.settings')} className="flex flex-col gap-3">
        <ul className="flex gap-5 overflow-x-auto border-b border-[var(--border)]">
          {groups.map((group) => (
            <li key={group.key} className="shrink-0">
              <Link
                to={group.pages[0]!.to}
                className={cn(
                  '-mb-px flex min-h-[var(--touch-min)] items-center border-b-[3px] px-0.5 font-semibold whitespace-nowrap no-underline',
                  group === current
                    ? 'border-[var(--accent)] text-[var(--text)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                )}
                // The router marks the group's first page itself; any page of the group marks it.
                aria-current={group === current ? 'true' : undefined}
              >
                {t(`settings.group_${group.key}`)}
              </Link>
            </li>
          ))}
        </ul>
        {current && current.pages.length > 1 ? (
          <ul
            className="flex flex-wrap gap-2"
            aria-label={t('settings.pages_in', { group: t(`settings.group_${current.key}`) })}
          >
            {current.pages.map((page) => (
              <li key={page.to}>
                <Link
                  to={page.to}
                  className="ks-btn ghost sm"
                  activeProps={{ 'aria-current': 'page', className: 'tonal' }}
                >
                  {page.label(t)}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </nav>
      <Outlet />
    </div>
  );
}
