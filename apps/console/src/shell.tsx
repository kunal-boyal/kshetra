import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { Avatar, Button, StatusBadge } from '@thelamp/ui-web';
import {
  Activity,
  Building2,
  KeyRound,
  Languages,
  LogOut,
  Megaphone,
  Plus,
  Receipt,
  Tags,
  UserRound,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Brand } from './brand';
import { useConsole } from './context';
import { useLanguage } from './i18n';

function NavLink({
  to,
  icon,
  children,
}: {
  to:
    | '/'
    | '/tenants/new'
    | '/plans'
    | '/billing'
    | '/announcements'
    | '/health'
    | '/support'
    | '/staff';
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="ks-rail-link"
      activeOptions={{ exact: to === '/' }}
      activeProps={{ 'aria-current': 'page' }}
    >
      {icon}
      <span>{children}</span>
    </Link>
  );
}

/** The environment badge's tone; the environment comes from the build, and local builds show none. */
const ENVIRONMENT_BADGE: Record<string, 'danger' | 'waiting'> = {
  production: 'danger',
  staging: 'waiting',
};

/**
 * The console's frame (the prototype's ConsoleRail): the rail's places in sections, the person
 * signed in at its foot, and the bar with the environment, the account and the language.
 */
export function Shell() {
  const { client } = useConsole();
  const { t, locale, setLocale } = useLanguage();
  const navigate = useNavigate();
  const staff = client.staff;
  const managesStaff = staff?.permissions.includes('platform.staff.manage') ?? false;
  const supports = staff?.permissions.includes('platform.support.request') ?? false;
  const createsTenants = staff?.permissions.includes('platform.tenant.manage') ?? false;
  const environment = import.meta.env.VITE_ENVIRONMENT;
  const badge = environment ? ENVIRONMENT_BADGE[environment] : undefined;
  const icon = (Glyph: typeof Building2) => <Glyph size={18} aria-hidden="true" />;
  const sections = [
    {
      key: 'customers',
      links: [
        { to: '/' as const, icon: icon(Building2), label: t('console.tenants') },
        ...(createsTenants
          ? [{ to: '/tenants/new' as const, icon: icon(Plus), label: t('console.new_tenant') }]
          : []),
        ...(supports
          ? [{ to: '/support' as const, icon: icon(KeyRound), label: t('console.support') }]
          : []),
      ],
    },
    {
      key: 'money',
      links: [
        { to: '/plans' as const, icon: icon(Tags), label: t('console.plans') },
        { to: '/billing' as const, icon: icon(Receipt), label: t('console.billing') },
      ],
    },
    {
      key: 'operations',
      links: [
        { to: '/health' as const, icon: icon(Activity), label: t('console.health') },
        { to: '/announcements' as const, icon: icon(Megaphone), label: t('console.announcements') },
        ...(managesStaff
          ? [{ to: '/staff' as const, icon: icon(Users), label: t('console.staff') }]
          : []),
      ],
    },
  ] as const;
  return (
    <div className="ks flex min-h-screen flex-col md:flex-row">
      <nav
        className="ks-rail md:sticky md:top-0 md:h-screen md:overflow-y-auto"
        aria-label={t('console.nav')}
      >
        <Brand label={t('console.nav')} />
        {sections.map((section) => (
          <div key={section.key} className="ks-rail-section">
            <p className="ks-rail-label" id={`nav-${section.key}`}>
              {t(`console.section_${section.key}`)}
            </p>
            <ul className="flex flex-col gap-0.5" aria-labelledby={`nav-${section.key}`}>
              {section.links.map((link) => (
                <li key={link.to}>
                  <NavLink to={link.to} icon={link.icon}>
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {staff ? (
          <div className="ks-rail-foot ks-rail-person">
            <Avatar name={staff.name} id={staff.id} size="sm" />
            <span>
              <span className="ks-title truncate">{staff.name}</span>
              <span className="ks-meta">
                {t(`console.role_${staff.role}`)} · {t('console.two_step_on')}
              </span>
            </span>
          </div>
        ) : null}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="ks-appbar">
          <p className="ks-appbar-org">
            {badge ? (
              <StatusBadge variant={badge}>
                {t(
                  environment === 'production'
                    ? 'console.environment_production'
                    : 'console.environment_staging',
                )}
              </StatusBadge>
            ) : null}
          </p>
          <div className="ks-appbar-tools">
            <Link to="/account" className="ks-btn ghost sm">
              <UserRound size={16} aria-hidden="true" />
              {t('console.account')}
            </Link>
            <Button
              variant="ghost"
              size="sm"
              lang={locale === 'en' ? 'hi' : 'en'}
              icon={<Languages size={16} aria-hidden="true" />}
              onClick={() => setLocale(locale === 'en' ? 'hi' : 'en')}
            >
              {locale === 'en' ? 'हिन्दी' : 'English'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<LogOut size={16} aria-hidden="true" />}
              onClick={async () => {
                await client.signOut();
                await navigate({ to: '/sign-in' });
              }}
            >
              {t('console.sign_out')}
            </Button>
          </div>
        </header>
        <main className="flex flex-col gap-6 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
