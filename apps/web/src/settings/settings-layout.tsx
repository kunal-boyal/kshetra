import { Link, Outlet } from '@tanstack/react-router';
import { useLanguage } from '../i18n';
import { useAccess } from '../people/data';

/**
 * Settings (spec 8.2, M2): the organisation, its rules, words and modules, then its roles,
 * designations, people fields, forms, catalogue and price lists, and the account types, territory levels and
 * metrics they work with, the holiday calendars, leave types and expense policies, who approves each kind of request, and the whole configuration as a file
 * to export and import.
 */
export function SettingsLayout() {
  const { t } = useLanguage();
  const access = useAccess();
  const links = [
    ...(access.can('settings.manage')
      ? [
          { to: '/settings/organisation', label: t('admin.organisation') },
          { to: '/settings/rules', label: t('admin.rules') },
        ]
      : []),
    ...(access.can('terminology.manage')
      ? [{ to: '/settings/terminology', label: t('admin.terminology') }]
      : []),
    ...(access.can('module.manage') || access.can('settings.manage')
      ? [{ to: '/settings/modules', label: t('admin.modules') }]
      : []),
    ...(access.can('role.manage') || access.can('user.manage')
      ? [{ to: '/settings/roles', label: t('nav.roles') }]
      : []),
    { to: '/settings/designations', label: t('nav.designations') },
    { to: '/settings/people-fields', label: t('nav.user_fields') },
    ...(access.can('form.manage') ? [{ to: '/settings/forms', label: t('nav.forms') }] : []),
    ...(access.can('catalogue.manage')
      ? [{ to: '/settings/catalogue', label: t('nav.catalogue') }]
      : []),
    ...(access.can('price_list.manage')
      ? [{ to: '/settings/price-lists', label: t('prices.title') }]
      : []),
    ...(access.can('settings.manage')
      ? [{ to: '/settings/account-types', label: t('types.title') }]
      : []),
    ...(access.can('territory.manage')
      ? [{ to: '/settings/territory-levels', label: t('levels.title') }]
      : []),
    ...(access.can('metric.manage')
      ? [{ to: '/settings/metrics', label: t('metrics.title') }]
      : []),
    ...(access.can('calendar.manage')
      ? [{ to: '/settings/calendars', label: t('calendars.title') }]
      : []),
    ...(access.can('leave_type.manage')
      ? [{ to: '/settings/leave-types', label: t('leave.types_title') }]
      : []),
    ...(access.can('expense_policy.manage')
      ? [{ to: '/settings/expense-policies', label: t('policies.title') }]
      : []),
    ...(access.can('workflow.manage')
      ? [{ to: '/settings/approvals', label: t('nav.approval_chains') }]
      : []),
    ...(access.can('settings.manage')
      ? [{ to: '/settings/configuration', label: t('config_file.title') }]
      : []),
  ];
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('nav.settings')}>
        <ul className="flex flex-wrap gap-2">
          {links.map((link) => (
            <li key={link.to}>
              <Link
                to={link.to}
                className="ks-btn ghost sm"
                activeProps={{ 'aria-current': 'page', className: 'tonal' }}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
