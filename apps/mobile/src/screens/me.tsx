import { spacing } from '@thelamp/design-tokens';
import { formatMoney, formatNumber, formatTime } from '@thelamp/i18n';
import { scaled, todayIn, unscaled } from '@thelamp/shared';
import {
  Avatar,
  Button,
  Card,
  IconChip,
  ListGroup,
  ListRow,
  Screen,
  SegmentedControl,
  StatusBadge,
  Text,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import {
  CalendarCheck,
  CalendarX,
  ClipboardList,
  CloudCheck,
  CloudUpload,
  FileLock2,
  LogOut,
  ReceiptText,
  Shield,
  Store,
  Trophy,
} from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig, useMe } from '../data';
import { appVersion } from '../device';
import { errorMessage, useLanguage } from '../i18n';
import { useDisplay } from '../look';
import type { Display } from '../preferences';
import { fixable, useMyAttendance, useQueuedFixes } from '../attendance';
import { useMyClaims } from '../expenses';
import { leaveLeft, useLeaveBalances, useLeaveTypes } from '../leave';
import { itemLabel } from '../outbox-kinds';
import { useMonth, useMyMonth } from '../performance';
import { useOutboxItems, useSync, useSyncStatus } from '../sync';
import { when } from '../when';
import { useShift } from './shift';

/**
 * More (spec 8.1, the prototype's fifth tab, decision D104): the person's work that has no tab of
 * its own (accounts and forms first), the profile, language, display, the upload queue and
 * sign-out, which warns about unsent records and about recording stopping on duty.
 * Attendance opens the month calendar, Leave the balances and requests (M13), and Expenses the
 * claims (M12); requests arrive with their module.
 */
export function MeScreen() {
  const { client, session } = useApp();
  const { t, locale, setLocale } = useLanguage();
  const { display, setDisplay } = useDisplay();
  const me = useMe();
  const config = useConfig();
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState(false);
  const status = useSyncStatus();
  const sync = useSync();
  const unsent = status ? status.counts.queued + status.counts.parked : 0;
  // Signing out on duty stops recording (BR-37), so it warns first (spec 14.5, step 7).
  const onDuty = Boolean(useShift().state);
  const tenant = session?.tenant;
  const permissions = new Set<string>(config.data?.bundle.access.permissions ?? []);
  // Leave is a module of its own (D64): switched off, it hides.
  const modulesOff = config.data?.bundle.settings.modulesOff ?? [];
  const leaveOn = !modulesOff.includes('leave_attendance');
  const expensesOn = !modulesOff.includes('expenses');
  const designation = config.data?.bundle.designations.find(
    (entry) => entry.key === me.data?.designation,
  );

  /** Runs an action; when it fails, the person is still signed in and sees why. */
  function act(work: () => Promise<void>) {
    setError(undefined);
    work().catch((caught: unknown) => setError(errorMessage(caught, t)));
  }

  const items = useOutboxItems();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';

  return (
    <Screen edges={['top', 'left', 'right']}>
      <Text variant="headingXl" role="heading">
        {t('app.more')}
      </Text>
      {me.data ? (
        <Card style={styles.profile}>
          <Avatar name={me.data.name} id={me.data.userId} size="lg" />
          <View style={styles.grow}>
            <Text variant="headingMd">{me.data.name}</Text>
            <Text variant="bodySm" tone="muted">
              {[designation?.name[locale].one ?? me.data.code, tenant?.name]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </Card>
      ) : null}
      {error ? (
        <Text tone="danger" weight={500} role="alert">
          {error}
        </Text>
      ) : null}

      {status ? (
        <View style={styles.stack}>
          <View style={styles.spread}>
            <Text variant="headingMd" role="heading" style={styles.grow}>
              {t('app.uploads')}
            </Text>
            {unsent > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                label={t('app.send_now')}
                busy={status.running}
                onPress={() => void sync?.runner.sync()}
              />
            ) : null}
          </View>
          <ListGroup>
            {items.length === 0 ? (
              <ListRow icon={CloudCheck} label={t('app.uploads_done')} />
            ) : (
              items
                .slice(0, QUEUE_SHOWN)
                .map((item) => (
                  <ListRow
                    key={item.id}
                    lead={
                      <IconChip icon={CloudUpload} hue={item.state === 'parked' ? 'rose' : 'sky'} />
                    }
                    label={itemLabel(item, t)}
                    detail={when(new Date(item.createdAt).toISOString(), { t, locale, timeZone })}
                    trailing={
                      <StatusBadge
                        variant={item.state === 'parked' ? 'danger' : 'pending'}
                        label={
                          item.state === 'parked' ? t('app.upload_stuck') : t('app.upload_waiting')
                        }
                      />
                    }
                    onPress={() => router.push('/uploads')}
                  />
                ))
            )}
            {items.length > QUEUE_SHOWN ? (
              <ListRow
                label={t('app.uploads_all', { count: items.length })}
                onPress={() => router.push('/uploads')}
              />
            ) : null}
          </ListGroup>
        </View>
      ) : null}

      <ListGroup title={t('app.my_work')}>
        {permissions.has('account.view') ? (
          <ListRow
            testID="more-accounts"
            lead={<IconChip icon={Store} hue="sky" />}
            label={t('accounts.title')}
            onPress={() => router.push('/accounts')}
          />
        ) : null}
        {permissions.has('submission.create') ? (
          <ListRow
            testID="more-forms"
            lead={<IconChip icon={ClipboardList} hue="sage" />}
            label={t('forms.title')}
            onPress={() => router.push('/forms')}
          />
        ) : null}
        {permissions.has('shift.use') || permissions.has('user.view') ? (
          <ListRow
            lead={<IconChip icon={CalendarCheck} hue="mint" />}
            label={t('attendance.title')}
            trailing={<DaysToFix />}
            onPress={() => router.push('/attendance')}
          />
        ) : null}
        {leaveOn && (permissions.has('shift.use') || permissions.has('user.view')) ? (
          <ListRow
            lead={<IconChip icon={CalendarX} hue="lilac" />}
            label={t('leave.title')}
            trailing={<LeaveLeftValue />}
            onPress={() => router.push('/leave')}
          />
        ) : null}
        {expensesOn && permissions.has('expense.claim') ? (
          <ListRow
            lead={<IconChip icon={ReceiptText} hue="peach" />}
            label={t('claims.title')}
            trailing={<ClaimsOpen />}
            onPress={() => router.push('/expenses')}
          />
        ) : null}
        {permissions.has('leaderboard.view') ? (
          <ListRow
            lead={<IconChip icon={Trophy} hue="butter" />}
            label={t('leaderboard.title')}
            trailing={<MyRank />}
            onPress={() => router.push('/leaderboard')}
          />
        ) : null}
      </ListGroup>

      <View style={styles.stack}>
        <Text variant="headingMd" role="heading">
          {t('app.this_phone')}
        </Text>
        <SegmentedControl
          label={t('shell.language')}
          value={locale}
          onChange={setLocale}
          choices={[
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'हिन्दी' },
          ]}
        />
        <SegmentedControl<Display>
          label={t('app.display')}
          value={display}
          onChange={setDisplay}
          choices={[
            { value: 'system', label: t('app.display_system') },
            { value: 'light', label: t('shell.theme_light') },
            { value: 'dark', label: t('shell.theme_dark') },
            { value: 'outdoor', label: t('app.display_outdoor') },
          ]}
        />
        <Text variant="bodySm" tone="muted">
          {t('app.display_help')}
        </Text>
      </View>

      <ListGroup>
        <ListRow
          icon={Shield}
          label={t('my_data.open')}
          onPress={() => router.push('/data-requests')}
        />
        <ListRow
          icon={FileLock2}
          label={t('privacy.open')}
          onPress={() => router.push('/privacy')}
        />
      </ListGroup>

      {warning ? (
        <Card style={styles.stack}>
          {onDuty ? (
            <Text weight={500} role="alert">
              {t('app.sign_out_on_duty')}
            </Text>
          ) : null}
          {unsent > 0 ? (
            <Text weight={500} role="alert">
              {t('app.sign_out_unsent', { count: unsent })}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button
              variant="danger"
              icon={LogOut}
              label={t('app.sign_out_anyway')}
              onPress={() => act(() => client.signOut())}
            />
            <Button
              variant="secondary"
              label={t('app.stay_signed_in')}
              onPress={() => setWarning(false)}
            />
          </View>
        </Card>
      ) : (
        <Button
          variant="secondary"
          block
          icon={LogOut}
          label={t('shell.sign_out')}
          // Unsent records stay on the phone for the next sign-in, but the person should know.
          onPress={() => (unsent > 0 || onDuty ? setWarning(true) : act(() => client.signOut()))}
        />
      )}

      <Text variant="caption" tone="subtle" style={styles.version}>
        {[
          t('app.version', { version: appVersion }),
          status?.lastPulledAt
            ? t('app.synced_at', {
                time: formatTime(new Date(status.lastPulledAt), { locale, timeZone }),
              })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </Screen>
  );
}

/** Upload queue rows More shows before the way to the whole queue. */
const QUEUE_SHOWN = 3;

/** The month's days still to fix, once the month is on the phone. */
function DaysToFix() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const period = todayIn(config.data?.bundle.settings.timezone ?? 'Asia/Kolkata').slice(0, 7);
  const days = useMyAttendance(period).data?.data.days;
  const queued = useQueuedFixes();
  if (!days) return null;
  const count = days.filter(
    (day) => day.status === 'absent' && fixable(day, queued.has(day.date)),
  ).length;
  return count > 0 ? (
    <Text variant="bodySm" tone="muted">
      {t('app.days_to_fix', { count, n: formatNumber(count, { locale }) })}
    </Text>
  ) : null;
}

/** The days left of paid leave this year, once the balances are on the phone. */
function LeaveLeftValue() {
  const { t, locale } = useLanguage();
  const types = useLeaveTypes().data;
  const balances = useLeaveBalances().data?.data;
  if (!types || !balances) return null;
  const days = leaveLeft(types, balances)
    .filter((entry) => entry.type.paid)
    .reduce((sum, entry) => sum + entry.available, 0);
  return (
    <Text variant="bodySm" tone="muted">
      {t('app.days_left', {
        count: days,
        n: formatNumber(days, { locale }, { maximumFractionDigits: 1 }),
      })}
    </Text>
  );
}

/** The month's claims still waiting for a decision, as an amount. */
function ClaimsOpen() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const settings = config.data?.bundle.settings;
  const period = todayIn(settings?.timezone ?? 'Asia/Kolkata').slice(0, 7);
  const claims = useMyClaims(period).data?.data;
  if (!claims) return null;
  const open = claims
    .filter((claim) => claim.state === 'pending')
    .reduce((sum, claim) => sum + scaled(claim.amount, 2), 0n);
  if (open === 0n) return null;
  return (
    <Text variant="bodySm" tone="muted">
      {t('app.claims_open', {
        amount: formatMoney(unscaled(open, 2) as `${number}`, {
          locale,
          currency: settings?.currency ?? 'INR',
        }),
      })}
    </Text>
  );
}

/** The person's rank this month, once the month is on the phone. */
function MyRank() {
  const { locale } = useLanguage();
  const rank = useMyMonth(useMonth()).data?.data.rank;
  return rank == null ? null : (
    <Text variant="bodySm" tone="muted">
      {`#${formatNumber(rank, { locale })}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  grow: { flex: 1, minWidth: 0 },
  spread: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  version: { textAlign: 'center', paddingBottom: spacing.space4 },
  stack: { gap: spacing.space3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
});
