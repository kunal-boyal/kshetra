import { formatNumber } from '@thelamp/i18n';
import { Avatar, Button, Icon, MenuButton } from '@thelamp/ui-web';
import { Link, Outlet } from '@tanstack/react-router';
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
  ShoppingCart,
  MapPinned,
  Network,
  Settings,
  ShieldCheck,
  Store,
  Target,
  Trophy,
  Users,
  Receipt,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { applyBrand } from '../brand';
import { useConfig, useMe } from '../data';
import { useWaiting } from '../dashboard/data';
import { designationName } from '../people/shared';
import { useOrganisation } from '../settings/data';
import { useUnread } from '../notifications/data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { Brand } from './brand';
import { LanguageToggle, ThemePicker } from './preferences-menu';
import { Announcements } from './announcements';
import { SupportBanner } from './support-banner';
import { StepUpPrompt } from '../step-up';

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

/**
 * One entry of the navigation rail; the current page is marked for the eye and for readers, and
 * what waits there is counted beside it (decision D104).
 */
function RailLink({
  link,
}: {
  link: { to: string; icon: typeof House; label: string; count?: number | null | undefined };
}) {
  const { t, locale } = useLanguage();
  const count = link.count ?? 0;
  return (
    <Link
      to={link.to}
      className="ks-rail-link"
      activeOptions={{ exact: link.to === '/' }}
      activeProps={{ 'aria-current': 'page' }}
      {...(count > 0 ? { 'aria-label': t('nav.waiting', { label: link.label, count }) } : {})}
    >
      <Icon icon={link.icon} />
      <span className="flex-1">{link.label}</span>
      {count > 0 ? (
        <span className="ks-badge neutral ks-rail-count" aria-hidden="true">
          {count > 99 ? '99+' : formatNumber(count, { locale })}
        </span>
      ) : null}
    </Link>
  );
}

/** The person's choices behind their avatar: who they are, sign-in security, the look, sign out. */
function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const me = useMe(client);
  const config = useConfig(client, useApp().queryClient);
  if (!me.data) return null;
  const designation = me.data.support
    ? t('support.title')
    : designationName(me.data.designation, config.data?.bundle.designations ?? [], locale);
  return (
    <MenuButton
      label={t('shell.account_menu')}
      trigger={<Avatar name={me.data.name} id={me.data.userId} size="sm" />}
    >
      {(close) => (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={me.data.name} id={me.data.userId} />
            <div className="min-w-0">
              <p className="ks-title truncate">{me.data.name}</p>
              <p className="ks-meta truncate">{designation}</p>
            </div>
          </div>
          {me.data.support ? null : (
            <Link to="/security" className="ks-btn ghost sm justify-start" onClick={close}>
              <Icon icon={ShieldCheck} size="sm" />
              {t('shell.security')}
            </Link>
          )}
          <ThemePicker />
          <Button
            size="sm"
            variant="secondary"
            icon={<Icon icon={LogOut} size="sm" />}
            onClick={() => {
              close();
              onSignOut();
            }}
          >
            {t('shell.sign_out')}
          </Button>
        </div>
      )}
    </MenuButton>
  );
}

export function AppShell() {
  const { client, queryClient } = useApp();
  const { t, setTerms } = useLanguage();
  const config = useConfig(client, queryClient);
  const organisation = useOrganisation();
  const [error, setError] = useState<string>();
  const tenant = client.session?.tenant;
  const orgName = organisation.data?.name || tenant?.name || '';
  const access = useAccess();
  const waiting = useWaiting().data;
  // Only what the person may use (spec 8.2), in sections; each module adds its entry when it
  // arrives, and a section with nothing in it isn't shown.
  type NavLink = { to: string; icon: typeof House; label: string; count?: number | null };
  const only = (allowed: boolean, link: NavLink): NavLink[] => (allowed ? [link] : []);
  const sections: { key: string; label: string; links: NavLink[] }[] = [
    {
      key: 'work',
      label: t('nav.section_work'),
      links: [
        { to: '/', icon: House, label: t('shell.home') },
        ...only(access.can('submission.review'), {
          to: '/review',
          icon: ClipboardCheck,
          label: t('nav.review'),
          count: waiting?.reviews,
        }),
        ...only(access.can('approval.act') || access.can('account.approve'), {
          to: '/approvals',
          icon: Inbox,
          label: t('nav.approvals'),
          count: waiting?.approvals,
        }),
        ...only(access.can('order.view') || access.can('order.create'), {
          to: '/orders',
          icon: ShoppingCart,
          label: t('nav.orders'),
        }),
        ...only(
          (access.can('expense.mark_paid') || access.can('approval.act')) &&
            !access.modulesOff.includes('expenses'),
          { to: '/expenses', icon: Receipt, label: t('nav.expenses') },
        ),
        ...only(access.can('live_map.view'), {
          to: '/live-map',
          icon: MapIcon,
          label: t('nav.live_map'),
        }),
      ],
    },
    {
      key: 'team',
      label: t('nav.section_team'),
      links: [
        ...only(access.can('user.view'), { to: '/people', icon: Users, label: t('nav.people') }),
        ...only(access.can('user.view'), {
          to: '/org-chart',
          icon: Network,
          label: t('nav.org_chart'),
        }),
        ...only(access.can('target.view'), {
          to: '/targets',
          icon: Target,
          label: t('nav.targets'),
        }),
        access.can('performance.view_team')
          ? { to: '/performance', icon: ChartNoAxesColumn, label: t('nav.performance') }
          : { to: '/performance/me', icon: ChartNoAxesColumn, label: t('nav.my_performance') },
        ...only(access.can('leaderboard.view'), {
          to: '/leaderboard',
          icon: Trophy,
          label: t('nav.leaderboard'),
        }),
      ],
    },
    {
      key: 'places',
      label: t('nav.section_places'),
      links: [
        ...only(access.can('account.view'), {
          to: '/accounts',
          icon: Store,
          label: t('nav.accounts'),
        }),
        ...only(access.can('territory.manage'), {
          to: '/territories',
          icon: MapPinned,
          label: t('nav.territories'),
        }),
      ],
    },
    {
      key: 'data',
      label: t('nav.section_data'),
      links: [
        ...only(access.can('report.view'), {
          to: '/reports',
          icon: Sheet,
          label: t('nav.reports'),
        }),
        ...only(access.can('import.run'), {
          to: '/imports',
          icon: FileSpreadsheet,
          label: t('nav.imports'),
        }),
      ],
    },
  ].filter((section) => section.links.length > 0);
  const settings = only(
    access.can('role.manage') ||
      access.can('designation.manage') ||
      access.can('settings.manage') ||
      access.can('terminology.manage') ||
      access.can('module.manage') ||
      access.can('form.manage') ||
      access.can('catalogue.manage') ||
      access.can('price_list.manage') ||
      access.can('territory.manage') ||
      access.can('metric.manage'),
    { to: '/settings', icon: Settings, label: t('nav.settings') },
  );

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

  return (
    <div className="ks min-h-screen md:grid md:grid-cols-[var(--nav-web)_1fr]">
      <a href="#content" className="sr-only focus:not-sr-only">
        {t('shell.skip')}
      </a>
      <nav
        aria-label={t('shell.navigation')}
        className="ks-rail md:sticky md:top-0 md:h-screen md:overflow-y-auto"
      >
        <Brand />
        {sections.map((section) => (
          <div key={section.key} className="ks-rail-section">
            <p className="ks-rail-label" id={`nav-${section.key}`}>
              {section.label}
            </p>
            <ul className="flex flex-col gap-0.5" aria-labelledby={`nav-${section.key}`}>
              {section.links.map((link) => (
                <li key={link.to}>
                  <RailLink link={link} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        {settings.length > 0 ? (
          <ul className="ks-rail-section ks-rail-foot">
            {settings.map((link) => (
              <li key={link.to}>
                <RailLink link={link} />
              </li>
            ))}
          </ul>
        ) : null}
      </nav>
      <div className="flex min-w-0 flex-col">
        <header className="ks-appbar">
          <p className="ks-appbar-org">
            {organisation.data?.logo ? (
              <img src={organisation.data.logo.url} alt="" />
            ) : orgName ? (
              <Avatar name={orgName} id={tenant?.id ?? orgName} size="sm" className="org" />
            ) : null}
            <span className="truncate">{orgName}</span>
          </p>
          <div className="ks-appbar-tools">
            <LanguageToggle />
            <NotificationsLink />
            <AccountMenu onSignOut={() => act(() => client.signOut())} />
          </div>
          {error ? (
            <p className="ks-help error w-full" role="alert">
              {error}
            </p>
          ) : null}
        </header>
        <SupportBanner onSignOut={() => act(() => client.signOut())} />
        <Announcements />
        <StepUpPrompt />
        <main id="content" className="mx-auto w-full max-w-[var(--content-max)] p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
