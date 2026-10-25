import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { Button } from '@thelamp/ui-web';
import {
  Building2,
  KeyRound,
  Languages,
  LogOut,
  Megaphone,
  Receipt,
  Tags,
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
  to: '/' | '/plans' | '/billing' | '/announcements' | '/support' | '/staff';
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

/** The console's frame: the rail with its places, and the bar with who is signed in. */
export function Shell() {
  const { client } = useConsole();
  const { t, locale, setLocale } = useLanguage();
  const navigate = useNavigate();
  const staff = client.staff;
  const managesStaff = staff?.permissions.includes('platform.staff.manage') ?? false;
  const supports = staff?.permissions.includes('platform.support.request') ?? false;
  return (
    <div className="ks flex min-h-screen flex-col md:flex-row">
      <nav
        className="ks-rail md:sticky md:top-0 md:h-screen md:overflow-y-auto"
        aria-label={t('console.nav')}
      >
        <Brand label={t('console.label')} />
        <ul className="ks-rail-section">
          <li>
            <NavLink to="/" icon={<Building2 size={18} aria-hidden="true" />}>
              {t('console.tenants')}
            </NavLink>
          </li>
          <li>
            <NavLink to="/plans" icon={<Tags size={18} aria-hidden="true" />}>
              {t('console.plans')}
            </NavLink>
          </li>
          <li>
            <NavLink to="/billing" icon={<Receipt size={18} aria-hidden="true" />}>
              {t('console.billing')}
            </NavLink>
          </li>
          <li>
            <NavLink to="/announcements" icon={<Megaphone size={18} aria-hidden="true" />}>
              {t('console.announcements')}
            </NavLink>
          </li>
          {supports ? (
            <li>
              <NavLink to="/support" icon={<KeyRound size={18} aria-hidden="true" />}>
                {t('console.support')}
              </NavLink>
            </li>
          ) : null}
          {managesStaff ? (
            <li>
              <NavLink to="/staff" icon={<Users size={18} aria-hidden="true" />}>
                {t('console.staff')}
              </NavLink>
            </li>
          ) : null}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="ks-appbar">
          <p className="ks-appbar-org">
            {staff
              ? t('console.signed_in_as', {
                  name: staff.name,
                  role: t(`console.role_${staff.role}`),
                })
              : null}
          </p>
          <div className="ks-appbar-tools">
            <Button
              variant="ghost"
              size="sm"
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
