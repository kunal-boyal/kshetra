import type { FormEntry } from '@thelamp/api-client/sync';
import { spacing } from '@thelamp/design-tokens';
import { formatDate, formatDateTime, formatMoney } from '@thelamp/i18n';
import { newId, PROPOSAL_ACCURACY_M, proposalFix } from '@thelamp/shared';
import {
  AppBar,
  Button,
  Card,
  IconChip,
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
  CloudUpload,
  RotateCw,
  ShoppingCart,
  Store,
  Tag,
  UserRound,
  Wallet,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { proposeLocation } from '../captures';
import { useConfig } from '../data';
import { standalone, startEntry } from '../forms/start';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { currentFix, type Fix } from '../location';
import { creditLeft, useBalance } from '../finance';
import { useOutboxItems, useSync, useSyncStatus } from '../sync';
import { useTodayPlan } from './today-plan';
import { CheckOutBar, useVisit, VisitCard } from './visit';
import { VisitMap } from './visit-map';

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
 * location, proposing where it is from a fresh fix of 50 m or better (M4), visits there (M6), and
 * what it pays (decision D77).
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
  const priceLists = useLocalRows('price_lists');
  const orders = useLocalRows('orders');
  const balance = useBalance(id);
  const waiting = useOutboxItems();
  const { visit } = useVisit();
  const today = useTodayPlan();
  const entries = useVisitEntries(visit?.visitId);
  const [locating, setLocating] = useState<Locating>({ step: 'idle' });
  const [error, setError] = useState<string>();
  // Proposed from this screen; it stays said once the upload leaves the queue.
  const [sent, setSent] = useState(false);

  const account = accounts?.find((entry) => entry.id === id);
  const bundle = config.data?.bundle;
  const type = bundle?.accountTypes?.find((entry) => entry.key === account?.type);
  const permissions = new Set<string>(bundle?.access.permissions ?? []);
  // Orders, prices included, and account finance are modules (D64): switched off, they hide.
  const modulesOff = bundle?.settings.modulesOff ?? [];
  const ordersOn = !modulesOff.includes('orders');
  const financeOn = !modulesOff.includes('account_finance');

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
  const timeZone = bundle?.settings.timezone ?? 'Asia/Kolkata';
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: bundle?.settings.currency ?? 'INR' });
  // The orders taken here, newest first, and those still on the phone.
  const ordersHere = (orders ?? [])
    .filter((entry) => entry.accountId === account.id)
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
    .slice(0, 10);
  const queuedHere = waiting.filter(
    (item) =>
      item.kind === 'order.place' &&
      (item.payload as { accountId?: string }).accountId === account.id,
  );
  const person = (userId: string) => users?.find((user) => user.id === userId);
  const here = visit?.accountId === account.id;
  // The visit's own forms open from the visit; each says once it was sent from this visit.
  const visitForms =
    here && permissions.has('submission.create')
      ? (bundle?.forms ?? []).filter(
          (form) =>
            form.visitSession &&
            form.accountLink.mode !== 'none' &&
            form.accountLink.accountTypes.includes(account.type),
        )
      : [];
  const sentHere = new Set(
    entries.filter((entry) => here && entry.state === 'queued').map((entry) => entry.formKey),
  );
  const stop = today.items.findIndex((item) => item.accountId === account.id);
  const typeIndex = (bundle?.accountTypes ?? []).findIndex((entry) => entry.key === account.type);
  const hue = HUES[Math.max(typeIndex, 0) % HUES.length]!;
  const contact = (contacts ?? []).find((entry) => entry.accountId === account.id && entry.active);
  const assigned = account.slots
    .map((holder) => person(holder.userId)?.name)
    .filter(Boolean)
    .join(', ');
  const fill = (formKey: string) => {
    const form = (bundle?.forms ?? []).find((entry) => entry.key === formKey);
    if (!form || !sync || !client.owner) return;
    startEntry(sync, client.owner, form, account.id).catch(() => setError(t('entry.not_saved')));
  };
  const mayOrder =
    ordersOn &&
    (priceLists?.length ?? 0) > 0 &&
    permissions.has('order.create') &&
    account.status === 'active';
  const showPrices = ordersOn && (priceLists?.length ?? 0) > 0;
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
    <Screen footer={here ? <CheckOutBar /> : undefined}>
      <AppBar
        title={
          stop >= 0
            ? t('visit.stop_of', { n: stop + 1, total: today.items.length })
            : (type?.name[locale].one ?? t('accounts.title'))
        }
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/accounts'))}
        backLabel={t('common.back')}
      />
      <View style={styles.head}>
        <IconChip icon={Store} hue={hue} size="lg" />
        <View style={styles.titles}>
          <Text variant="headingLg" role="heading">
            {account.name}
          </Text>
          <Text variant="bodySm" tone="muted">
            {[type?.name[locale].one, account.code, territory?.name].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.wrap}>
            <StatusBadge
              variant={account.locationStatus === 'verified' ? 'success' : 'pending'}
              label={t(`account.location_${account.locationStatus}`)}
            />
            {account.status !== 'active' ? (
              <StatusBadge
                variant={account.status === 'pending' ? 'waiting' : 'neutral'}
                label={t(`account.status_${account.status}`)}
              />
            ) : null}
          </View>
        </View>
      </View>

      {account.location ? <VisitMap account={account} type={type} /> : null}
      <VisitCard account={account} type={type} />

      {visitForms.length > 0 || linkedForms.length > 0 || mayOrder || showPrices ? (
        <ListGroup title={t(here ? 'visit.on_this_visit' : 'account.to_do_here')}>
          {visitForms.map((form) => (
            <ListRow
              key={form.key}
              lead={<IconChip icon={ClipboardList} hue="sage" />}
              label={form.name[locale].one}
              {...(sentHere.has(form.key)
                ? { trailing: <StatusBadge variant="success" label={t('visit.form_sent')} /> }
                : {})}
              onPress={() => fill(form.key)}
            />
          ))}
          {linkedForms.map((form) => (
            <ListRow
              key={form.key}
              lead={<IconChip icon={ClipboardList} hue="sky" />}
              label={form.name[locale].one}
              onPress={() => fill(form.key)}
            />
          ))}
          {mayOrder ? (
            <ListRow
              lead={<IconChip icon={ShoppingCart} hue="butter" />}
              label={t('orders.take')}
              onPress={() =>
                router.push({ pathname: '/order/[accountId]', params: { accountId: account.id } })
              }
            />
          ) : null}
          {showPrices ? (
            <ListRow
              lead={<IconChip icon={Tag} hue="sand" />}
              label={t('prices.see')}
              onPress={() =>
                router.push({ pathname: '/prices/[accountId]', params: { accountId: account.id } })
              }
            />
          ) : null}
        </ListGroup>
      ) : null}

      <Card style={styles.card}>
        <Detail
          label={t('account.contact')}
          value={contact ? [contact.name, contact.role].filter(Boolean).join(', ') : '—'}
        />
        <Detail label={t('account.assigned')} value={assigned || t('account.unassigned')} />
        <Detail
          label={t('account.territory')}
          value={territory ? `${territory.name} (${territory.code})` : '—'}
        />
        {address ? <Detail label={t('account.address')} value={address} /> : null}
        <Detail
          label={t('account.location')}
          value={
            account.location
              ? `${account.location.lat.toFixed(5)}, ${account.location.lng.toFixed(5)}`
              : t('account.no_location')
          }
        />
      </Card>

      {balance && financeOn && permissions.has('finance.view') ? (
        <ListGroup title={t('finance.owes')}>
          <ListRow
            icon={Wallet}
            label={money(balance.outstanding)}
            detail={t('finance.owes_as_of', {
              date: formatDate(balance.asOf, { locale }),
            })}
          />
          {balance.creditLimit !== null ? (
            <ListRow
              label={
                creditLeft(balance)!.startsWith('-')
                  ? t('finance.over_limit', { amount: money(creditLeft(balance)!.slice(1)) })
                  : t('finance.credit_left', { amount: money(creditLeft(balance)!) })
              }
              detail={t('finance.limit_of', { amount: money(balance.creditLimit) })}
              {...(creditLeft(balance)!.startsWith('-') ? { tone: 'danger' as const } : {})}
            />
          ) : null}
          {(bundle?.settings.ageingBuckets ?? []).flatMap((bucket) =>
            balance.ageing[bucket.key]
              ? [
                  <ListRow
                    key={bucket.key}
                    label={money(balance.ageing[bucket.key]!)}
                    detail={
                      bucket.toDays === null
                        ? t('finance.bucket_over', { days: bucket.fromDays - 1 })
                        : t('finance.bucket', { from: bucket.fromDays, to: bucket.toDays })
                    }
                  />,
                ]
              : [],
          )}
        </ListGroup>
      ) : null}
      {ordersOn && (ordersHere.length > 0 || queuedHere.length > 0) ? (
        <ListGroup title={t('orders.here')}>
          {queuedHere.map((item) => (
            <ListRow
              key={item.id}
              icon={CloudUpload}
              label={t('orders.waiting_to_send')}
              detail={formatDateTime(new Date(item.createdAt), { locale, timeZone })}
            />
          ))}
          {ordersHere.map((entry) => (
            <ListRow
              key={entry.id}
              icon={ShoppingCart}
              label={`${t(`orders.status_${entry.status}`)} · ${money(entry.total)}`}
              detail={formatDateTime(new Date(entry.placedAt), { locale, timeZone })}
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

/**
 * The entries sent from a visit, read again whenever the sync's status moves (a submit saves
 * through it), so a form says it was sent once its screen closes.
 */
function useVisitEntries(visitId: string | undefined): FormEntry[] {
  const { client } = useApp();
  const sync = useSync();
  const status = useSyncStatus();
  const [entries, setEntries] = useState<FormEntry[]>([]);
  useEffect(() => {
    const owner = client.owner;
    if (!sync || !owner || !visitId) return;
    let live = true;
    void sync.entries.list(owner).then((found) => {
      if (live) setEntries(found.filter((entry) => entry.visitId === visitId));
    });
    return () => {
      live = false;
    };
  }, [sync, client, status, visitId]);
  return entries;
}

/** The account types' hues, in the order the tenant lists its types (components/IconChip). */
export const HUES = ['sky', 'mint', 'butter', 'lilac', 'peach', 'rose', 'sage', 'sand'] as const;

/** One line of the account's details (`ks-dl`): what, then its value. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text variant="labelSm" tone="muted">
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
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
  card: { gap: spacing.space3 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.space3 },
  titles: { flex: 1, minWidth: 0, gap: spacing.space1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
  detail: { gap: spacing.space05 },
});
