import {
  AppBar,
  Avatar,
  EmptyState,
  ListGroup,
  ListRow,
  Screen,
  TextField,
} from '@thelamp/ui-mobile';
import { type Href, router } from 'expo-router';
import {
  CalendarCheck,
  ChartNoAxesColumn,
  ClipboardList,
  House,
  LayoutGrid,
  type LucideIcon,
  Receipt,
  Search,
  ShoppingCart,
  Store,
  Sun,
  Users,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';

type Translate = ReturnType<typeof useLanguage>['t'];

/** The most matches of each kind the screen lists, as the portal's search does (D110). */
const LIMIT = 5;

export interface PhoneScreen {
  path: Href;
  label: string;
  icon: LucideIcon;
}

/**
 * The screens a person may open, by the same rules as the tabs and More's My work: their
 * permissions and the modules the tenant has on.
 */
export function phoneScreens(
  permissions: ReadonlySet<string>,
  modulesOff: readonly string[],
  t: Translate,
): PhoneScreen[] {
  const can = (permission: string) => permissions.has(permission);
  const on = (module: string) => !modulesOff.includes(module);
  const all: (PhoneScreen | false)[] = [
    { path: '/', label: t('app.home'), icon: House },
    can('visit.use') && { path: '/plan', label: t('plan.title'), icon: CalendarCheck },
    can('order.create') &&
      on('orders') && { path: '/orders', label: t('orders.title'), icon: ShoppingCart },
    (can('submission.review') ||
      can('live_map.view') ||
      can('approval.act') ||
      can('account.approve')) && { path: '/team', label: t('team.title'), icon: Users },
    { path: '/me', label: t('app.more'), icon: LayoutGrid },
    can('account.view') && { path: '/accounts', label: t('accounts.title'), icon: Store },
    can('submission.create') && { path: '/forms', label: t('forms.title'), icon: ClipboardList },
    (can('shift.use') || can('user.view')) && {
      path: '/attendance',
      label: t('attendance.title'),
      icon: CalendarCheck,
    },
    on('leave_attendance') &&
      (can('shift.use') || can('user.view')) && {
        path: '/leave',
        label: t('leave.title'),
        icon: Sun,
      },
    on('expenses') &&
      can('expense.claim') && { path: '/expenses', label: t('claims.title'), icon: Receipt },
    can('leaderboard.view') && {
      path: '/leaderboard',
      label: t('leaderboard.title'),
      icon: ChartNoAxesColumn,
    },
  ];
  return all.filter((entry): entry is PhoneScreen => entry !== false);
}

/**
 * Search on the phone (phase 4 step A1, decision D110): the screens the person may open, and the
 * accounts and people the phone keeps, so it works without signal. A person opens their day, so
 * people show only for those who may replay one; the person's orders stay in the Orders tab.
 */
export function SearchScreen() {
  const { t } = useLanguage();
  const config = useConfig();
  const bundle = config.data?.bundle;
  const permissions = useMemo(
    () => new Set<string>(bundle?.access.permissions ?? []),
    [bundle?.access.permissions],
  );
  const accounts = useLocalRows('accounts');
  const people = useLocalRows('users');
  const [text, setText] = useState('');
  const words = text.trim().toLocaleLowerCase();

  const found = useMemo(() => {
    if (!words) return null;
    const has = (...values: (string | null | undefined)[]) =>
      values.some((value) => value?.toLocaleLowerCase().includes(words));
    const screens = phoneScreens(permissions, bundle?.settings.modulesOff ?? [], t).filter(
      (screen) => has(screen.label),
    );
    return {
      screens: screens.slice(0, LIMIT),
      accounts: permissions.has('account.view')
        ? (accounts ?? []).filter((account) => has(account.name, account.code)).slice(0, LIMIT)
        : [],
      people: permissions.has('trail.view')
        ? (people ?? []).filter((person) => has(person.name, person.code)).slice(0, LIMIT)
        : [],
    };
  }, [accounts, bundle?.settings.modulesOff, people, permissions, t, words]);

  const nothing =
    found !== null && found.screens.length + found.accounts.length + found.people.length === 0;

  return (
    <Screen>
      <AppBar title={t('search.label')} onBack={() => router.back()} backLabel={t('common.back')} />
      <TextField
        label={t('search.label')}
        labelHidden
        icon={Search}
        placeholder={t('search.placeholder')}
        value={text}
        onChangeText={setText}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />
      {nothing ? (
        <EmptyState icon={Search} title={t('search.nothing', { q: text.trim() })}>
          {t('search.phone_kept')}
        </EmptyState>
      ) : null}
      {found && found.screens.length > 0 ? (
        <ListGroup title={t('search.group_screens')}>
          {found.screens.map((screen) => (
            <ListRow
              key={String(screen.path)}
              icon={screen.icon}
              label={screen.label}
              onPress={() => router.push(screen.path)}
            />
          ))}
        </ListGroup>
      ) : null}
      {found && found.accounts.length > 0 ? (
        <ListGroup title={t('search.group_accounts')}>
          {found.accounts.map((account) => (
            <ListRow
              key={account.id}
              icon={Store}
              label={account.name}
              detail={account.code}
              onPress={() =>
                router.push({ pathname: '/accounts/[id]', params: { id: account.id } })
              }
            />
          ))}
        </ListGroup>
      ) : null}
      {found && found.people.length > 0 ? (
        <ListGroup title={t('search.group_people')}>
          {found.people.map((person) => (
            <ListRow
              key={person.id}
              lead={<Avatar name={person.name} id={person.id} size="sm" />}
              label={person.name}
              detail={person.code}
              onPress={() => router.push({ pathname: '/day/[id]', params: { id: person.id } })}
            />
          ))}
        </ListGroup>
      ) : null}
    </Screen>
  );
}
