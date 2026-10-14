import type { VisitState } from '@kshetra/api-client/sync';
import { spacing } from '@kshetra/design-tokens';
import type { AccountType, FormView } from '@kshetra/forms';
import { formatDateTime, formatNumber } from '@kshetra/i18n';
import { punchFixIssue, type SyncAccount } from '@kshetra/shared';
import { Button, Card, ListGroup, ListRow, Notice, StatusBadge, Text } from '@kshetra/ui-mobile';
import { router } from 'expo-router';
import { ClipboardList, LogIn, LogOut, MapPin } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig } from '../data';
import { startEntry } from '../forms/start';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { currentFix, type Fix } from '../location';
import { useSync, useSyncStatus } from '../sync';
import { checkIn, checkOut, geofenceAt } from '../visits';
import { useShift } from './shift';

/**
 * The person's open visit on this phone, read again whenever the sync's status moves (every
 * check-in and check-out saves through it) and every minute, as a visit can go idle.
 */
export function useVisit(): { visit: VisitState | null | undefined; refresh: () => void } {
  const { client } = useApp();
  const sync = useSync();
  const status = useSyncStatus();
  const [visit, setVisit] = useState<VisitState | null>();
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const owner = client.owner;
    if (!sync || !owner) return;
    let live = true;
    void sync.visits.current(owner).then((found) => {
      if (live) setVisit(found);
    });
    return () => {
      live = false;
    };
  }, [sync, client, status, tick]);
  return { visit, refresh };
}

type Said = { kind: 'error'; text: string } | { kind: 'note'; text: string } | { kind: 'none' };

/**
 * A visit at an account (M6, spec 8.1): check in with a fresh fix judged against the geofence on
 * the phone first, fill the visit's forms, and check out. Under a required geofence a check-in
 * outside it is refused with the distance; under an advisory one it goes ahead, marked outside.
 */
export function VisitCard({
  account,
  type,
}: {
  account: SyncAccount;
  type: AccountType | undefined;
}) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const sync = useSync();
  const config = useConfig();
  const shift = useShift();
  const { visit, refresh } = useVisit();
  const accounts = useLocalRows('accounts');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>({ kind: 'none' });
  const bundle = config.data?.bundle;
  const permissions = new Set<string>(bundle?.access.permissions ?? []);
  if (!bundle || !permissions.has('visit.use') || account.status !== 'active') return null;
  if (!sync || !client.owner || visit === undefined || shift.state === undefined) return null;
  const owner = client.owner;
  const settings = bundle.settings;
  const here = visit?.accountId === account.id;
  const elsewhere = visit && !here ? accounts?.find((entry) => entry.id === visit.accountId) : null;
  const metres = (value: number) => formatNumber(value, { locale });
  const visitForms: FormView[] = permissions.has('submission.create')
    ? (bundle.forms ?? []).filter(
        (form) =>
          form.visitSession &&
          form.accountLink.mode !== 'none' &&
          form.accountLink.accountTypes.includes(account.type),
      )
    : [];

  /** A fresh fix good enough for a record, or what is wrong with it said on the card. */
  async function freshFix(): Promise<Fix | null> {
    const found = await currentFix();
    if (found.status !== 'ready') {
      setSaid({
        kind: 'error',
        text: t(found.status === 'denied' ? 'shift.fix_denied' : 'shift.fix_unavailable'),
      });
      return null;
    }
    const issue = punchFixIssue(found.fix);
    if (issue) {
      setSaid({
        kind: 'error',
        text: t(issue === 'GPS_MOCKED' ? 'shift.fix_mocked' : 'shift.fix_vague'),
      });
      return null;
    }
    return found.fix;
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setSaid({ kind: 'none' });
    try {
      await work();
      await sync!.runner.refresh();
      void sync!.runner.sync();
    } catch {
      setSaid({ kind: 'error', text: t('account.not_saved') });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function arrive() {
    const fix = await freshFix();
    if (!fix) return;
    const fence = geofenceAt(account, type, settings, fix);
    if (fence.policy === 'required' && fence.result === 'outside') {
      setSaid({
        kind: 'error',
        text: t('visit.too_far', {
          distance: metres(fence.distanceM ?? 0),
          radius: metres(fence.radiusM),
        }),
      });
      return;
    }
    await act(async () => {
      await checkIn(sync!, owner, { accountId: account.id, fix });
    });
    if (fence.result === 'outside' && fence.policy === 'advisory') {
      setSaid({
        kind: 'note',
        text: t('visit.outside', { distance: metres(fence.distanceM ?? 0) }),
      });
    } else if (fence.result === 'unknown' && fence.policy !== 'off') {
      setSaid({ kind: 'note', text: t('visit.no_location') });
    }
  }

  async function leave() {
    // A check-out without a fix still counts; the fix is only recorded when there is one.
    const found = await currentFix();
    await act(() => checkOut(sync!, owner, found.status === 'ready' ? found.fix : null));
  }

  return (
    <Card style={styles.stack}>
      <View style={styles.row}>
        <Text variant="headingMd" style={styles.grow}>
          {t('visit.title')}
        </Text>
        {here ? <StatusBadge variant="success" label={t('visit.in_visit')} /> : null}
      </View>
      {here ? (
        <>
          <Text tone="muted">
            {t('visit.since', {
              time: formatDateTime(new Date(visit.checkedInAt), {
                locale,
                timeZone: settings.timezone,
              }),
            })}
          </Text>
          {visitForms.length > 0 ? (
            <ListGroup title={t('visit.forms')}>
              {visitForms.map((form) => (
                <ListRow
                  key={form.key}
                  icon={ClipboardList}
                  label={form.name[locale].one}
                  onPress={() => {
                    startEntry(sync, owner, form, account.id).catch(() =>
                      setSaid({ kind: 'error', text: t('entry.not_saved') }),
                    );
                  }}
                />
              ))}
            </ListGroup>
          ) : null}
          <Button
            variant="secondary"
            icon={LogOut}
            label={t('visit.check_out')}
            busy={busy}
            onPress={() => void leave()}
          />
        </>
      ) : !shift.state ? (
        <Text tone="muted">{t('visit.need_shift')}</Text>
      ) : (
        <>
          {elsewhere !== null && visit ? (
            <Notice>{t('visit.elsewhere', { name: elsewhere?.name ?? '—' })}</Notice>
          ) : (
            <Text tone="muted">{t('visit.help')}</Text>
          )}
          <Button
            variant="primary"
            icon={LogIn}
            label={t('visit.check_in')}
            busy={busy}
            onPress={() => void arrive()}
          />
        </>
      )}
      {said.kind === 'error' ? (
        <Text tone="danger" role="alert">
          {said.text}
        </Text>
      ) : said.kind === 'note' ? (
        <Notice>{said.text}</Notice>
      ) : null}
    </Card>
  );
}

/** On Home, the visit the person is in, which opens its account. */
export function VisitNow() {
  const { t } = useLanguage();
  const { visit } = useVisit();
  const accounts = useLocalRows('accounts');
  if (!visit) return null;
  const account = accounts?.find((entry) => entry.id === visit.accountId);
  return (
    <ListRow
      icon={MapPin}
      label={t('visit.in_visit_at', { name: account?.name ?? '—' })}
      onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: visit.accountId } })}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  grow: { flex: 1 },
});
