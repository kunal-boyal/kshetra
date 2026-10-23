import { spacing } from '@thelamp/design-tokens';
import { newId, PROPOSAL_ACCURACY_M, proposalFix } from '@thelamp/shared';
import {
  Button,
  Card,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  StatusBadge,
  Text,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import {
  ArrowLeft,
  ClipboardList,
  Crosshair,
  MapPin,
  Phone,
  RotateCw,
  UserRound,
} from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { proposeLocation } from '../captures';
import { useConfig } from '../data';
import { standalone, startEntry } from '../forms/start';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { currentFix, type Fix } from '../location';
import { useOutboxItems, useSync } from '../sync';
import { VisitCard } from './visit';

type Locating =
  | { step: 'idle' }
  | { step: 'locating' }
  | { step: 'vague'; accuracy: number }
  | { step: 'denied' }
  | { step: 'unavailable' }
  | { step: 'ready'; fix: Fix; proposedAt: string };

/**
 * An account's overview on the phone (spec 8.1): its details, who looks after it and its
 * contacts, from the phone's copy, the forms linked to its type, and, for one without a verified
 * location, proposing where it is from a fresh fix of 50 m or better (M4), and visits there (M6).
 */
export function AccountScreen({ id }: { id: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const sync = useSync();
  const config = useConfig();
  const accounts = useLocalRows('accounts');
  const contacts = useLocalRows('contacts');
  const users = useLocalRows('users');
  const territories = useLocalRows('territories');
  const waiting = useOutboxItems();
  const [locating, setLocating] = useState<Locating>({ step: 'idle' });
  const [error, setError] = useState<string>();
  // Proposed from this screen; it stays said once the upload leaves the queue.
  const [sent, setSent] = useState(false);

  const account = accounts?.find((entry) => entry.id === id);
  const bundle = config.data?.bundle;
  const type = bundle?.accountTypes?.find((entry) => entry.key === account?.type);
  const permissions = new Set<string>(bundle?.access.permissions ?? []);

  if (accounts === undefined) {
    return (
      <Screen>
        <Text tone="muted">{t('common.loading')}</Text>
      </Screen>
    );
  }
  if (!account) {
    return (
      <Screen>
        <Back />
        <Text tone="muted">{t('account.gone')}</Text>
      </Screen>
    );
  }

  const proposed =
    sent ||
    waiting.some(
      (item) =>
        item.kind === 'account.location' &&
        (item.payload as { accountId?: string }).accountId === account.id,
    );
  const mayPropose =
    permissions.has('account.propose_location') &&
    (type?.location.fieldUsersMayPropose ?? false) &&
    account.status === 'active' &&
    account.locationStatus !== 'verified';
  // Forms linked to this type, filled here on their own; visit forms open from a visit.
  const linkedForms =
    permissions.has('submission.create') && account.status === 'active'
      ? standalone(bundle?.forms ?? []).filter(
          (form) =>
            form.accountLink.mode !== 'none' &&
            form.accountLink.accountTypes.includes(account.type),
        )
      : [];
  const territory = territories?.find((node) => node.id === account.territoryId);
  const person = (userId: string) => users?.find((user) => user.id === userId);
  const address = [
    account.address.line,
    account.address.city,
    account.address.state,
    account.address.pin,
  ]
    .filter(Boolean)
    .join(', ');

  async function locate() {
    setError(undefined);
    setLocating({ step: 'locating' });
    const state = await currentFix();
    if (state.status !== 'ready') {
      setLocating({ step: state.status });
      return;
    }
    const proposedAt = new Date().toISOString();
    setLocating(
      proposalFix(state.fix, new Date(proposedAt)) === 'ok'
        ? { step: 'ready', fix: state.fix, proposedAt }
        : { step: 'vague', accuracy: Math.round(state.fix.accuracy) },
    );
  }

  async function propose() {
    if (locating.step !== 'ready' || !sync || !client.owner) return;
    try {
      await proposeLocation(sync, client.owner, {
        id: newId(),
        accountId: account!.id,
        lat: locating.fix.lat,
        lng: locating.fix.lng,
        accuracy: locating.fix.accuracy,
        capturedAt: locating.fix.capturedAt,
        proposedAt: locating.proposedAt,
      });
      setSent(true);
      setLocating({ step: 'idle' });
    } catch {
      setError(t('account.not_saved'));
    }
  }

  return (
    <Screen>
      <Back />
      <Text variant="headingXl" role="heading">
        {account.name}
      </Text>
      <View style={styles.row}>
        <Text tone="muted">
          {[account.code, type?.name[locale].one].filter(Boolean).join(' · ')}
        </Text>
        {account.status !== 'active' ? (
          <StatusBadge
            variant={account.status === 'pending' ? 'waiting' : 'neutral'}
            label={t(`account.status_${account.status}`)}
          />
        ) : null}
      </View>

      <VisitCard account={account} type={type} />

      <Card style={styles.card}>
        <Text variant="labelSm" tone="muted">
          {t('account.territory')}
        </Text>
        <Text>{territory ? `${territory.name} (${territory.code})` : '—'}</Text>
        {address ? (
          <>
            <Text variant="labelSm" tone="muted">
              {t('account.address')}
            </Text>
            <Text>{address}</Text>
          </>
        ) : null}
        <Text variant="labelSm" tone="muted">
          {t('account.location')}
        </Text>
        <View style={styles.row}>
          <Text style={styles.grow}>
            {account.location
              ? `${account.location.lat.toFixed(5)}, ${account.location.lng.toFixed(5)}`
              : t('account.no_location')}
          </Text>
          <StatusBadge
            variant={account.locationStatus === 'verified' ? 'success' : 'pending'}
            label={t(`account.location_${account.locationStatus}`)}
          />
        </View>
      </Card>

      {linkedForms.length > 0 ? (
        <ListGroup title={t('account.fill_form')}>
          {linkedForms.map((form) => (
            <ListRow
              key={form.key}
              icon={ClipboardList}
              label={form.name[locale].one}
              onPress={() => {
                if (!sync || !client.owner) return;
                startEntry(sync, client.owner, form, account.id).catch(() =>
                  setError(t('entry.not_saved')),
                );
              }}
            />
          ))}
        </ListGroup>
      ) : null}
      {error && !mayPropose ? (
        <Text tone="danger" role="alert">
          {error}
        </Text>
      ) : null}

      {mayPropose ? (
        <Card style={styles.card}>
          <Text variant="headingMd">{t('account.propose_location')}</Text>
          {proposed ? (
            <Notice>{t('account.location_queued')}</Notice>
          ) : locating.step === 'ready' ? (
            <>
              <Text>{t('account.fix_ready', { accuracy: Math.round(locating.fix.accuracy) })}</Text>
              <Button
                variant="primary"
                icon={MapPin}
                label={t('account.propose_here')}
                onPress={() => void propose()}
              />
            </>
          ) : (
            <>
              <Text tone="muted">
                {locating.step === 'vague'
                  ? t('account.fix_vague', {
                      accuracy: locating.accuracy,
                      needed: PROPOSAL_ACCURACY_M,
                    })
                  : locating.step === 'denied'
                    ? t('account.fix_denied')
                    : locating.step === 'unavailable'
                      ? t('account.fix_unavailable')
                      : t('account.propose_help', { needed: PROPOSAL_ACCURACY_M })}
              </Text>
              <Button
                variant="tonal"
                icon={locating.step === 'idle' ? Crosshair : RotateCw}
                label={t(locating.step === 'idle' ? 'account.find_me' : 'common.retry')}
                busy={locating.step === 'locating'}
                onPress={() => void locate()}
              />
            </>
          )}
          {error ? (
            <Text tone="danger" role="alert">
              {error}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <ListGroup title={t('account.slots')}>
        {account.slots.length === 0 ? (
          <ListRow label={t('account.unassigned')} icon={UserRound} />
        ) : (
          account.slots.map((holder) => (
            <ListRow
              key={holder.slot}
              label={person(holder.userId)?.name ?? '—'}
              detail={
                type?.slots.find((slot) => slot.key === holder.slot)?.name[locale] ?? holder.slot
              }
              icon={UserRound}
            />
          ))
        )}
      </ListGroup>

      {type?.contacts ? (
        <ListGroup title={t('account.contacts')}>
          {(contacts ?? []).filter((contact) => contact.accountId === account.id && contact.active)
            .length === 0 ? (
            <ListRow label={t('contact.none')} icon={Phone} />
          ) : (
            (contacts ?? [])
              .filter((contact) => contact.accountId === account.id && contact.active)
              .map((contact) => (
                <ListRow
                  key={contact.id}
                  label={contact.name}
                  detail={[contact.role, contact.phone].filter(Boolean).join(' · ')}
                  icon={Phone}
                />
              ))
          )}
        </ListGroup>
      ) : null}
    </Screen>
  );
}

function Back() {
  const { t } = useLanguage();
  return (
    <Button
      variant="ghost"
      icon={ArrowLeft}
      label={t('common.back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/accounts'))}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  grow: { flex: 1 },
  card: { gap: spacing.space2 },
});
