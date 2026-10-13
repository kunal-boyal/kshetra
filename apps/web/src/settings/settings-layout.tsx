import { Link, Outlet } from '@tanstack/react-router';
import { useLanguage } from '../i18n';
import { useAccess } from '../people/data';

/** Settings (spec 8.2): the organisation's roles, designations, people fields, forms and catalogue. */
export function SettingsLayout() {
  const { t } = useLanguage();
  const access = useAccess();
  const links = [
    ...(access.can('role.manage') || access.can('user.manage')
      ? [{ to: '/settings/roles', label: t('nav.roles') }]
      : []),
    { to: '/settings/designations', label: t('nav.designations') },
    { to: '/settings/people-fields', label: t('nav.user_fields') },
    ...(access.can('form.manage') ? [{ to: '/settings/forms', label: t('nav.forms') }] : []),
    ...(access.can('catalogue.manage')
      ? [{ to: '/settings/catalogue', label: t('nav.catalogue') }]
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
