import { Button, Icon } from '@kshetra/ui-web';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import {
  Bell,
  ChartNoAxesColumn,
  ClipboardCheck,
  FileSpreadsheet,
  House,
  Inbox,
  LogOut,
  Map as MapIcon,
  Sheet,
  MapPinned,
  Network,
  Repeat,
  Settings,
  Store,
  Target,
  Trophy,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { applyBrand } from '../brand';
import { useConfig } from '../data';
import { useOrganisation } from '../settings/data';
import { useUnread } from '../notifications/data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { savedTenants } from '../preferences';
import { Brand } from './brand';
import { LanguagePicker, ThemePicker } from './preferences-menu';

/**
 * The portal's frame (spec 8.2): navigation on the left, the tenant and the person's choices on
 * top. Navigation shows only what the person may use; each module adds its entry when it arrives.
 */
/** The inbox, from the header, with how many are unread (M16). */
function NotificationsLink() {
  const { t } = useLanguage();
  const unread = useUnread().data ?? 0;
  return (
    <Link
      to="/notifications"
      className="ks-btn ghost sm"
      aria-label={t('notifications.open', { count: unread })}
    >
      <Icon icon={Bell} size="sm" />
      {unread > 0 ? <span aria-hidden="true">{unread > 99 ? '99+' : unread}</span> : null}
    </Link>
  );
}

export function AppShell() {
  const { client, queryClient } = useApp();
  const navigate = useNavigate();
  const { t, setTerms } = useLanguage();
  const config = useConfig(client, queryClient);
  const organisation = useOrganisation();
  const [error, setError] = useState<string>();
  const tenant = client.session?.tenant;
  const others = savedTenants().filter((choice) => choice.id !== tenant?.id);
  const access = useAccess();
  // Only what the person may use (spec 8.2); each module adds its entry when it arrives.
  const links = [
    { to: '/', icon: House, label: t('shell.home') },
    ...(access.can('user.view')
      ? [
          { to: '/people', icon: Users, label: t('nav.people') },
          { to: '/org-chart', icon: Network, label: t('nav.org_chart') },
        ]
      : []),
    ...(access.can('account.view')
      ? [{ to: '/accounts', icon: Store, label: t('nav.accounts') }]
      : []),
    ...(access.can('approval.act') || access.can('account.approve')
      ? [{ to: '/approvals', icon: Inbox, label: t('nav.approvals') }]
      : []),
    ...(access.can('submission.review')
      ? [{ to: '/review', icon: ClipboardCheck, label: t('nav.review') }]
      : []),
    ...(access.can('live_map.view')
      ? [{ to: '/live-map', icon: MapIcon, label: t('nav.live_map') }]
      : []),
    ...(access.can('target.view')
      ? [{ to: '/targets', icon: Target, label: t('nav.targets') }]
      : []),
    access.can('performance.view_team')
      ? { to: '/performance', icon: ChartNoAxesColumn, label: t('nav.performance') }
      : { to: '/performance/me', icon: ChartNoAxesColumn, label: t('nav.my_performance') },
    ...(access.can('leaderboard.view')
      ? [{ to: '/leaderboard', icon: Trophy, label: t('nav.leaderboard') }]
      : []),
    ...(access.can('report.view')
      ? [{ to: '/reports', icon: Sheet, label: t('nav.reports') }]
      : []),
    ...(access.can('territory.manage')
      ? [{ to: '/territories', icon: MapPinned, label: t('nav.territories') }]
      : []),
    ...(access.can('import.run')
      ? [{ to: '/imports', icon: FileSpreadsheet, label: t('nav.imports') }]
      : []),
    ...(access.can('role.manage') ||
    access.can('designation.manage') ||
    access.can('settings.manage') ||
    access.can('terminology.manage') ||
    access.can('module.manage') ||
    access.can('form.manage') ||
    access.can('catalogue.manage')
      ? [{ to: '/settings', icon: Settings, label: t('nav.settings') }]
      : []),
  ];

  useEffect(() => {
    setTerms(config.data?.bundle.terminology);
  }, [config.data, setTerms]);

  // The tenant's accent, from its brand colour, once the config has it (decision D64).
  const brandColour = config.data?.bundle.settings.brandColour;
  useEffect(() => {
    if (brandColour !== undefined) applyBrand(brandColour);
  }, [brandColour]);

  /** Runs a menu action; when it fails, the person is still signed in and sees why. */
  function act(work: () => Promise<void>) {
    setError(undefined);
    work().catch((caught: unknown) => setError(errorMessage(caught, t)));
  }

  async function switchTo(tenantId: string) {
    await client.switchTenant(tenantId);
    queryClient.clear();
    await navigate({ to: '/' });
  }

  return (
    <div className="ks min-h-screen md:grid md:grid-cols-[var(--nav-web)_1fr]">
      <a href="#content" className="sr-only focus:not-sr-only">
        {t('shell.skip')}
      </a>
      <nav
        aria-label={t('shell.navigation')}
        className="flex flex-col gap-6 border-[var(--border)] bg-[var(--surface)] p-4 md:min-h-screen md:border-r"
      >
        <Brand />
        <ul className="flex flex-col gap-1">
          {links.map((link) => (
            <li key={link.to}>
              <Link
                to={link.to}
                className="ks-btn ghost block"
                // The button style centres its content; a menu reads from the start.
                style={{ justifyContent: 'flex-start' }}
                activeOptions={{ exact: link.to === '/' }}
                activeProps={{ 'aria-current': 'page', className: 'tonal' }}
              >
                <Icon icon={link.icon} />
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3">
          <p className="heading-md flex items-center gap-3">
            {organisation.data?.logo ? (
              <img
                src={organisation.data.logo.url}
                alt=""
                className="h-8 w-auto max-w-[8rem] object-contain"
              />
            ) : null}
            {organisation.data?.name || tenant?.name}
          </p>
          <div className="flex flex-wrap items-center gap-2" aria-label={t('shell.account_menu')}>
            <NotificationsLink />
            <LanguagePicker />
            <ThemePicker />
            {others.map((choice) => (
              <Button
                key={choice.id}
                size="sm"
                variant="ghost"
                icon={<Icon icon={Repeat} size="sm" />}
                onClick={() => act(() => switchTo(choice.id))}
              >
                {t('shell.switch_organisation')}: {choice.name}
              </Button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              icon={<Icon icon={LogOut} size="sm" />}
              onClick={() => act(() => client.signOut())}
            >
              {t('shell.sign_out')}
            </Button>
          </div>
          {error ? (
            <p className="ks-help error w-full" role="alert">
              {error}
            </p>
          ) : null}
        </header>
        <main id="content" className="mx-auto w-full max-w-[var(--content-max)] p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
