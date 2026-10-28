import { spacing } from '@thelamp/design-tokens';
import type { AccountTypeView } from '@thelamp/forms';
import { formatNumber } from '@thelamp/i18n';
import { distanceMeters, type SyncAccount } from '@thelamp/shared';
import {
  AppBar,
  Button,
  ChoiceGroup,
  EmptyState,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  Text,
  TextField,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { MapPin, Plus, Store } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { useFix } from '../location';

type Translate = ReturnType<typeof useLanguage>['t'];

/** A distance as a person reads it: metres nearby, kilometres further. */
function distanceText(metres: number, t: Translate, locale: 'en' | 'hi'): string {
  return metres < 1000
    ? t('accounts.away_m', { distance: formatNumber(Math.round(metres), { locale }) })
    : t('accounts.away_km', { distance: formatNumber(Math.round(metres / 100) / 10, { locale }) });
}

/** The types a field user may propose from the phone. */
export function proposableTypes(
  types: readonly AccountTypeView[],
  permissions: ReadonlySet<string>,
): AccountTypeView[] {
  if (!permissions.has('account.propose')) return [];
  return types.filter((type) => type.active && type.creation === 'field_users_with_approval');
}

/**
 * Accounts (spec 8.1): the ones the person sees, kept on the phone, so search and filters work
 * without signal. Nearest first once the phone knows where it is; the rest by name.
 */
export function AccountsScreen() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const rows = useLocalRows('accounts');
  const fix = useFix();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const bundle = config.data?.bundle;
  const types = (bundle?.accountTypes ?? []).filter((entry) => entry.active);
  const permissions = new Set<string>(bundle?.access.permissions ?? []);
  const proposable = proposableTypes(types, permissions);
  const here = fix.status === 'ready' ? fix.fix : null;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matching = (rows ?? []).filter(
      (account) =>
        (type === 'all' || account.type === type) &&
        (!needle ||
          account.name.toLowerCase().includes(needle) ||
          account.code.toLowerCase().includes(needle)),
    );
    const away = (account: SyncAccount) =>
      here && account.location ? distanceMeters(here, account.location) : null;
    return matching
      .map((account) => ({ account, away: away(account) }))
      .sort((a, b) =>
        a.away !== null && b.away !== null
          ? a.away - b.away
          : a.away !== null
            ? -1
            : b.away !== null
              ? 1
              : a.account.name.localeCompare(b.account.name),
      );
  }, [rows, q, type, here]);

  const typeName = (key: string) =>
    types.find((entry) => entry.key === key)?.name[locale].one ?? key;

  return (
    <Screen>
      {/* Off the tab bar since D104: reached from Home and More, so it goes back there. */}
      <AppBar
        title={t('accounts.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        backLabel={t('common.back')}
      />
      <TextField
        label={t('accounts.search')}
        help={t('accounts.search_help')}
        value={q}
        onChangeText={setQ}
        autoCorrect={false}
      />
      {types.length > 1 ? (
        <ChoiceGroup
          title={t('accounts.type')}
          value={type}
          choices={[
            { value: 'all', label: t('common.any') },
            ...types.map((entry) => ({ value: entry.key, label: entry.name[locale].other })),
          ]}
          onChange={setType}
        />
      ) : null}
      {fix.status === 'denied' ? <Notice>{t('accounts.no_location')}</Notice> : null}

      {proposable.length > 0 ? (
        <View style={styles.actions}>
          {proposable.map((entry) => (
            <Button
              key={entry.key}
              variant="tonal"
              icon={Plus}
              label={t('accounts.propose', { type: entry.name[locale].one })}
              onPress={() =>
                router.push({ pathname: '/accounts/new', params: { type: entry.key } })
              }
            />
          ))}
        </View>
      ) : null}

      {rows === undefined ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : shown.length === 0 ? (
        <EmptyState icon={Store} title={t('accounts.empty_title')}>
          {t('accounts.empty_phone')}
        </EmptyState>
      ) : (
        <ListGroup title={t('accounts.count', { count: shown.length })}>
          {shown.map(({ account, away }) => (
            <ListRow
              key={account.id}
              label={account.name}
              detail={[
                account.code,
                types.length > 1 ? typeName(account.type) : null,
                away !== null ? distanceText(away, t, locale) : null,
                account.status === 'pending' ? t('account.status_pending') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              icon={account.location ? MapPin : Store}
              onPress={() =>
                router.push({ pathname: '/accounts/[id]', params: { id: account.id } })
              }
            />
          ))}
        </ListGroup>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.space2 },
});
