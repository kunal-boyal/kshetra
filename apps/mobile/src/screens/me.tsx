import { spacing } from '@thelamp/design-tokens';
import { Button, Card, ChoiceGroup, ListGroup, ListRow, Screen, Text } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import {
  Building2,
  CalendarCheck,
  CalendarX,
  CloudUpload,
  LogOut,
  ReceiptText,
  Repeat,
} from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig, useMe } from '../data';
import { appVersion } from '../device';
import { errorMessage, useLanguage } from '../i18n';
import { useDisplay } from '../look';
import type { Display } from '../preferences';
import { savedTenants } from '../preferences';
import { useSyncStatus } from '../sync';
import { useShift } from './shift';

/**
 * Me (spec 8.1). For now it holds what the More screen will: the profile, the tenant switcher,
 * language, display, the upload queue and sign-out, which warns about unsent records and about
 * recording stopping on duty.
 * Attendance opens the month calendar, Leave the balances and requests (M13), and Expenses the
 * claims (M12); requests arrive with their module.
 */
export function MeScreen() {
  const { client, queryClient, session, sync } = useApp();
  const { t, locale, setLocale } = useLanguage();
  const { display, setDisplay } = useDisplay();
  const me = useMe();
  const config = useConfig();
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState(false);
  const status = useSyncStatus();
  const unsent = status ? status.counts.queued + status.counts.parked : 0;
  // Signing out on duty stops recording (BR-37), so it warns first (spec 14.5, step 7).
  const onDuty = Boolean(useShift().state);
  const tenant = session?.tenant;
  const others = savedTenants().filter((choice) => choice.id !== tenant?.id);
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

  return (
    <Screen edges={['top', 'left', 'right']}>
      <Text variant="headingXl" role="heading">
        {t('app.me')}
      </Text>
      {me.data ? (
        <Card>
          <Text variant="headingLg">{me.data.name}</Text>
          <Text variant="bodySm" tone="muted">
            {[me.data.code, designation?.name[locale].one].filter(Boolean).join(' · ')}
          </Text>
        </Card>
      ) : null}
      {error ? (
        <Text tone="danger" weight={500} role="alert">
          {error}
        </Text>
      ) : null}

      <ListGroup title={t('app.organisation')}>
        <ListRow icon={Building2} label={tenant?.name ?? ''} />
        {others.map((other) => (
          <ListRow
            key={other.id}
            icon={Repeat}
            label={other.name}
            detail={t('shell.switch_organisation')}
            onPress={() =>
              act(async () => {
                await client.switchTenant(other.id);
                queryClient.clear();
                sync();
              })
            }
          />
        ))}
      </ListGroup>

      <ChoiceGroup
        title={t('shell.language')}
        value={locale}
        onChange={setLocale}
        choices={[
          { value: 'en', label: 'English' },
          { value: 'hi', label: 'हिन्दी' },
        ]}
      />

      <ChoiceGroup<Display>
        title={t('app.display')}
        value={display}
        onChange={setDisplay}
        choices={[
          { value: 'system', label: t('app.display_system') },
          { value: 'light', label: t('shell.theme_light') },
          { value: 'dark', label: t('shell.theme_dark') },
          { value: 'outdoor', label: t('app.display_outdoor'), detail: t('app.display_help') },
        ]}
      />

      {permissions.has('shift.use') || permissions.has('user.view') ? (
        <ListGroup>
          <ListRow
            icon={CalendarCheck}
            label={t('attendance.title')}
            detail={t('attendance.me_detail')}
            onPress={() => router.push('/attendance')}
          />
          {leaveOn ? (
            <ListRow
              icon={CalendarX}
              label={t('leave.title')}
              detail={t('leave.me_detail')}
              onPress={() => router.push('/leave')}
            />
          ) : null}
          {expensesOn && permissions.has('expense.claim') ? (
            <ListRow
              icon={ReceiptText}
              label={t('claims.title')}
              detail={t('claims.me_detail')}
              onPress={() => router.push('/expenses')}
            />
          ) : null}
        </ListGroup>
      ) : null}

      {status ? (
        <ListGroup>
          <ListRow
            icon={CloudUpload}
            label={t('app.uploads')}
            detail={
              unsent > 0 ? t('app.uploads_waiting', { count: unsent }) : t('app.uploads_done')
            }
            onPress={() => router.push('/uploads')}
          />
        </ListGroup>
      ) : null}

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
        <ListGroup>
          <ListRow
            icon={LogOut}
            tone="danger"
            label={t('shell.sign_out')}
            // Unsent records stay on the phone for the next sign-in, but the person should know.
            onPress={() => (unsent > 0 || onDuty ? setWarning(true) : act(() => client.signOut()))}
          />
        </ListGroup>
      )}

      <Text variant="caption" tone="subtle" style={styles.version}>
        {t('app.version', { version: appVersion })}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  version: { textAlign: 'center', paddingBottom: spacing.space4 },
  stack: { gap: spacing.space3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
});
