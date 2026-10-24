import { spacing } from '@thelamp/design-tokens';
import { formatDate, formatMoney, formatMonth } from '@thelamp/i18n';
import { EXPENSE_DESCRIPTION, newId, todayIn } from '@thelamp/shared';
import { Button, Card, ChoiceGroup, Notice, Screen, Text, TextField } from '@thelamp/ui-mobile';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Camera, ChevronLeft, ChevronRight, RotateCw, Send } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { takeResults } from '../capture-results';
import { useConfig, useMe } from '../data';
import {
  type Claimed,
  previewClaim,
  queueClaim,
  queuedClaim,
  useExpensePolicies,
  useMyClaims,
  useQueuedExpenses,
} from '../expenses';
import { errorMessage, useLanguage } from '../i18n';
import { useSync } from '../sync';
import { MonthDays, monthDates, shiftMonth } from './month-days';

const RECEIPT_REQUEST = 'claim-receipt';
const ODOMETER_REQUEST = 'claim-odometer';

/**
 * Claiming an expense on the phone (spec 8.1 Me, M12, BR-29): a policy, the day picked on a month,
 * a description, the readings, days or bill the policy pays by, and receipt and odometer photos
 * from the camera. The live amount and what the server would refuse come from the kept policy and
 * the person's kept and queued claims; the claim queues after its photos and waits for a signal.
 */
export function NewClaimScreen() {
  const { t, locale } = useLanguage();
  const { client } = useApp();
  const sync = useSync();
  const config = useConfig();
  const me = useMe();
  const settings = config.data?.bundle.settings;
  const today = todayIn(settings?.timezone ?? 'Asia/Kolkata');
  const currency = settings?.currency ?? 'INR';
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [policyKey, setPolicyKey] = useState<string>();
  const [day, setDay] = useState(today);
  const [description, setDescription] = useState('');
  const [odometerOpen, setOdometerOpen] = useState('');
  const [odometerClose, setOdometerClose] = useState('');
  const [days, setDays] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [receiptIds, setReceiptIds] = useState<string[]>([]);
  const [odometerPhotoIds, setOdometerPhotoIds] = useState<string[]>([]);
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const waiting = useRef<'receipt' | 'odometer' | null>(null);

  const policies = useExpensePolicies();
  const active = (policies.data ?? []).filter((policy) => policy.active);
  const policy = active.find((entry) => entry.key === policyKey) ?? active[0];
  const claims = useMyClaims(day.slice(0, 7));
  const queued = useQueuedExpenses();
  const claimed: Claimed[] = [
    ...(claims.data?.data ?? []),
    ...queued.claims.map((claim) =>
      queuedClaim(claim, policies.data ?? [], me.data?.designation ?? ''),
    ),
  ];
  const filled = (text: string) => (text.trim() ? text.trim() : undefined);
  const preview =
    policy && me.data
      ? previewClaim({
          policy,
          designation: me.data.designation,
          expenseDate: day,
          today,
          days: filled(days),
          odometerOpen: filled(odometerOpen),
          odometerClose: filled(odometerClose),
          billAmount: filled(billAmount),
          odometerPhotos: odometerPhotoIds.length,
          claimed,
        })
      : null;
  const shortDescription = description.trim().length < EXPENSE_DESCRIPTION.min;
  const money = (amount: string) => formatMoney(amount as `${number}`, { locale, currency });

  // Back from the camera with a receipt or an odometer photo.
  useFocusEffect(
    useCallback(() => {
      const kind = waiting.current;
      if (!kind) return;
      waiting.current = null;
      const taken = takeResults(kind === 'receipt' ? RECEIPT_REQUEST : ODOMETER_REQUEST);
      if (taken.length === 0) return;
      if (kind === 'receipt') setReceiptIds((current) => [...current, ...taken]);
      else setOdometerPhotoIds((current) => [...current, ...taken]);
    }, []),
  );

  function photograph(kind: 'receipt' | 'odometer') {
    waiting.current = kind;
    router.push({
      pathname: '/camera',
      params: { kind, request: kind === 'receipt' ? RECEIPT_REQUEST : ODOMETER_REQUEST },
    });
  }

  async function send() {
    if (!sync || !client.owner || !policy || !preview) return;
    if (preview.issues.length > 0 || shortDescription) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const calculation = policy.calculation;
      await queueClaim(sync, client.owner, {
        id: newId(),
        policy: policy.key,
        expenseDate: day,
        description: description.trim(),
        ...(calculation === 'per_day' ? { days: days.trim() } : {}),
        ...(calculation === 'per_km'
          ? { odometerOpen: odometerOpen.trim(), odometerClose: odometerClose.trim() }
          : {}),
        ...(calculation === 'actual' ? { billAmount: billAmount.trim() } : {}),
        receiptIds,
        odometerPhotoIds: calculation === 'per_km' ? odometerPhotoIds : [],
      });
      await sync.runner.refresh();
      // It goes now if the phone has a connection, and with the next sync if not.
      void sync.runner.sync();
      router.back();
    } catch (caught) {
      setFailure(errorMessage(caught, t));
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/expenses'))}
      />
      <Text variant="headingXl" role="heading">
        {t('claims.new_title')}
      </Text>

      {!policies.data ? (
        policies.isError ? (
          <View style={styles.stack}>
            <Text tone="danger" role="alert">
              {errorMessage(policies.error, t)}
            </Text>
            <Button
              variant="secondary"
              icon={RotateCw}
              label={t('common.retry')}
              onPress={() => void policies.refetch()}
            />
          </View>
        ) : (
          <Text tone="muted">{t('common.loading')}</Text>
        )
      ) : (
        <>
          <ChoiceGroup
            title={t('claims.policy')}
            value={policy?.key ?? ''}
            onChange={setPolicyKey}
            choices={active.map((entry) => ({
              value: entry.key,
              label: entry.name[locale],
              detail: t(`policies.calc_${entry.calculation}`),
            }))}
          />

          <Text tone="muted">{t('claims.pick_day')}</Text>
          <View style={styles.months}>
            <Button
              variant="ghost"
              icon={ChevronLeft}
              label={t('attendance.previous')}
              onPress={() => setPeriod(shiftMonth(period, -1))}
            />
            <Text variant="headingMd" style={styles.month}>
              {formatMonth(period, { locale })}
            </Text>
            <Button
              variant="ghost"
              icon={ChevronRight}
              label={t('attendance.next')}
              disabled={period >= today.slice(0, 7)}
              onPress={() => setPeriod(shiftMonth(period, 1))}
            />
          </View>
          <MonthDays
            dates={monthDates(period)}
            onPick={setDay}
            look={(date) =>
              date === day
                ? {
                    label: t('claims.cell_chosen', { date: formatDate(date, { locale }) }),
                    tone: 'info',
                    selected: true,
                  }
                : { label: formatDate(date, { locale }) }
            }
          />

          <TextField
            label={t('claims.description')}
            help={t('claims.description_help')}
            required
            maxLength={EXPENSE_DESCRIPTION.max}
            value={description}
            onChangeText={setDescription}
          />

          {policy?.calculation === 'per_km' ? (
            <View style={styles.stack}>
              <TextField
                label={t('claims.opening')}
                help={t('claims.readings_help')}
                numeric
                keyboardType="decimal-pad"
                value={odometerOpen}
                onChangeText={setOdometerOpen}
              />
              <TextField
                label={t('claims.closing')}
                help={t('claims.readings_help')}
                numeric
                keyboardType="decimal-pad"
                value={odometerClose}
                onChangeText={setOdometerClose}
              />
              <Text tone="muted">
                {t('claims.odometer_count', { count: odometerPhotoIds.length })}
              </Text>
              <Button
                variant="secondary"
                icon={Camera}
                label={t('claims.take_odometer')}
                onPress={() => photograph('odometer')}
              />
            </View>
          ) : null}
          {policy?.calculation === 'per_day' ? (
            <TextField
              label={t('claims.days')}
              help={t('claims.days_help')}
              numeric
              keyboardType="decimal-pad"
              value={days}
              onChangeText={setDays}
            />
          ) : null}
          {policy?.calculation === 'actual' ? (
            <TextField
              label={t('claims.bill')}
              numeric
              keyboardType="decimal-pad"
              value={billAmount}
              onChangeText={setBillAmount}
            />
          ) : null}
          {policy?.calculation === 'per_visit' ? <Notice>{t('claims.visits_note')}</Notice> : null}

          {policy?.receiptRequired ? <Notice>{t('claims.receipt_needed')}</Notice> : null}
          <Text tone="muted">{t('claims.receipt_count', { count: receiptIds.length })}</Text>
          <Button
            variant="secondary"
            icon={Camera}
            label={t('claims.take_receipt')}
            onPress={() => photograph('receipt')}
          />

          {preview ? (
            <Card style={styles.stack}>
              {preview.amount !== null ? (
                <Text variant="headingMd">
                  {t('claims.comes_to', { amount: money(preview.amount) })}
                </Text>
              ) : null}
              {preview.capped && preview.calculated ? (
                <Text tone="muted">
                  {t('claims.capped_from', { amount: money(preview.calculated) })}
                </Text>
              ) : null}
              {preview.issues.map((issue) => (
                <Text key={issue.issue} tone="danger" role="alert">
                  {t(`claims.issue_${issue.issue}`)}
                </Text>
              ))}
              {description.trim() && shortDescription ? (
                <Text tone="danger" role="alert">
                  {t('claims.description_short')}
                </Text>
              ) : null}
            </Card>
          ) : null}
          {failure ? (
            <Text tone="danger" role="alert">
              {failure}
            </Text>
          ) : null}
          <Button
            variant="primary"
            icon={Send}
            label={t('claims.send')}
            busy={busy}
            disabled={!preview || preview.issues.length > 0 || shortDescription || !sync}
            onPress={() => void send()}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { flex: 1, textAlign: 'center' },
});
