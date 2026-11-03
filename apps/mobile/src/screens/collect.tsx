import { spacing } from '@thelamp/design-tokens';
import { formatDate, formatMoney, formatMonth } from '@thelamp/i18n';
import {
  type CollectionIssue,
  type CollectionModeKey,
  COLLECTION_MODES,
  collectionIssues,
  Money,
  newId,
  type RecordCollectionBody,
  scaled,
  todayIn,
} from '@thelamp/shared';
import {
  ActionBar,
  AppBar,
  Button,
  Card,
  ChipGroup,
  IconButton,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  Text,
  TextField,
} from '@thelamp/ui-mobile';
import { router, useFocusEffect } from 'expo-router';
import { Camera, Check, ChevronLeft, ChevronRight, Share2, Wallet } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { takeResults } from '../capture-results';
import {
  accountCollected,
  cashThatDay,
  overdueOf,
  queueCollection,
  receiptMessage,
  settlesFirst,
  useCollections,
} from '../collections';
import { useConfig, useMe } from '../data';
import { useBalance, useOpenInvoices } from '../finance';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { currentFix } from '../location';
import { useSync } from '../sync';
import { captureFix } from '../visits';
import { MonthDays, monthDates, shiftMonth } from './month-days';
import { useVisit } from './visit';

const PHOTO_REQUEST = 'collection-cheque';

/** A typed amount, without the separators people type. */
const typed = (value: string) => value.trim().replace(/,/g, '');

/**
 * `/collect/<accountId>`: money taken from an account (M11, BR-63, decision D132), recorded
 * offline. What the account owes comes from the phone's balance and collections; its open
 * invoices, and which of them the amount settles first, when online. The mode asks for its
 * reference, a cheque for its number, bank, date and photo, and cash says when it would pass the
 * day's limit. Saved, it queues after the photo and the visit's check-in, and the shop owner can
 * be sent a receipt that says it awaits the office.
 */
export function CollectScreen({ accountId }: { accountId: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const sync = useSync();
  const config = useConfig();
  const me = useMe();
  const { visit } = useVisit();
  const accounts = useLocalRows('accounts');
  const bundle = config.data?.bundle;
  const settings = bundle?.settings;
  const timezone = settings?.timezone ?? 'Asia/Kolkata';
  const today = todayIn(timezone);
  const permissions = new Set<string>(bundle?.access.permissions ?? []);
  const balance = useBalance(accountId);
  const collections = useCollections(timezone);
  const invoices = useOpenInvoices(accountId, permissions.has('finance.view')).data?.items;
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<CollectionModeKey>('cash');
  const [reference, setReference] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeBank, setChequeBank] = useState('');
  const [chequeDate, setChequeDate] = useState(today);
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [saved, setSaved] = useState<RecordCollectionBody | null>(null);
  const waiting = useRef(false);

  const account = accounts?.find((entry) => entry.id === accountId);
  const money = (value: string) =>
    formatMoney(value as `${number}`, { locale, currency: settings?.currency ?? 'INR' });
  const value = typed(amount);
  const valid = Money.safeParse(value).success;
  const cashLimit = settings?.collectionCashLimit ?? null;
  const takenToday = cashThatDay(collections ?? [], accountId, today);
  const issues: CollectionIssue[] = collectionIssues({
    amount: valid ? value : '0',
    mode,
    collectedOn: today,
    today,
    reference,
    chequeNumber,
    chequeBank,
    chequeDate,
    photos: photos.length,
    cashThatDay: takenToday,
    cashLimit,
  });
  const overLimit = valid && issues.some((issue) => issue.issue === 'over_cash_limit');
  const owes = accountCollected(balance, collections ?? [], accountId);
  const overdue = overdueOf(invoices);
  const preview =
    valid && scaled(value, 2) > 0n && invoices && invoices.length > 0
      ? settlesFirst(invoices, collections ?? [], accountId, value)
      : null;

  // Back from the camera with the cheque's photo.
  useFocusEffect(
    useCallback(() => {
      if (!waiting.current) return;
      waiting.current = false;
      const taken = takeResults(PHOTO_REQUEST);
      if (taken.length > 0) setPhotos((current) => [...current, ...taken].slice(0, 3));
    }, []),
  );

  function photograph() {
    waiting.current = true;
    router.push({ pathname: '/camera', params: { kind: 'collection', request: PHOTO_REQUEST } });
  }

  async function save() {
    setTried(true);
    setFailure(undefined);
    if (!sync || !client.owner || !valid || issues.length > 0) return;
    setBusy(true);
    try {
      const found = await currentFix();
      if (found.status !== 'ready') {
        setFailure(
          t(found.status === 'denied' ? 'collect.fix_denied' : 'location.fix_unavailable'),
        );
        return;
      }
      const given = (text: string) => (text.trim() ? text.trim() : null);
      const body: RecordCollectionBody = {
        id: newId(),
        accountId,
        visitId: visit?.accountId === accountId ? visit.visitId : null,
        amount: value,
        mode,
        reference: mode === 'upi' || mode === 'bank_transfer' ? given(reference) : null,
        chequeNumber: mode === 'cheque' ? given(chequeNumber) : null,
        chequeBank: mode === 'cheque' ? given(chequeBank) : null,
        chequeDate: mode === 'cheque' ? chequeDate : null,
        note: given(note),
        photos: mode === 'cheque' ? photos : [],
        fix: captureFix(found.fix),
        collectedAt: new Date().toISOString(),
      };
      await queueCollection(sync, client.owner, body);
      await sync.runner.refresh();
      // It goes now if the phone has a connection, and with the next sync if not.
      void sync.runner.sync();
      setSaved(body);
    } catch {
      setFailure(t('account.not_saved'));
    } finally {
      setBusy(false);
    }
  }

  async function share(body: RecordCollectionBody) {
    const message = receiptMessage(
      { ...body, number: null, status: 'recorded', date: formatDate(today, { locale }) },
      { name: account?.name ?? '', code: account?.code ?? '' },
      me.data?.name ?? null,
      t,
      money,
    );
    // The share sheet may be closed without sending; nothing depends on it.
    if (message) await Share.share({ message }).catch(() => undefined);
  }

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/accounts/[id]', params: { id: accountId } });

  if (accounts !== undefined && !account) {
    return (
      <Screen>
        <AppBar title={t('collect.title')} onBack={back} backLabel={t('common.back')} />
        <Text tone="muted">{t('account.gone')}</Text>
      </Screen>
    );
  }

  if (saved) {
    return (
      <Screen
        edges={['top', 'left', 'right', 'bottom']}
        footer={
          <ActionBar>
            <View style={styles.grow}>
              <Button
                variant="primary"
                block
                icon={Check}
                label={t('collect.done')}
                onPress={back}
              />
            </View>
          </ActionBar>
        }
      >
        <AppBar title={t('collect.title')} onBack={back} backLabel={t('common.back')} />
        <Notice tone="success">
          {t('collect.saved', { amount: money(saved.amount), name: account?.name ?? '' })}
        </Notice>
        <Text tone="muted">{t('collect.share_help')}</Text>
        <Button
          variant="secondary"
          icon={Share2}
          label={t('collect.share')}
          onPress={() => void share(saved)}
        />
      </Screen>
    );
  }

  const shown = (issue: CollectionIssue['issue']) =>
    tried && issues.some((entry) => entry.issue === issue)
      ? t(`collect.issue_${issue}`)
      : undefined;

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <ActionBar>
          <View style={styles.grow}>
            <Button
              variant="primary"
              block
              icon={Wallet}
              label={
                valid && scaled(value, 2) > 0n
                  ? t('collect.save_amount', { amount: money(value) })
                  : t('collect.save')
              }
              busy={busy}
              disabled={!sync || !account || (tried && (issues.length > 0 || !valid))}
              onPress={() => void save()}
            />
          </View>
        </ActionBar>
      }
    >
      <AppBar title={t('collect.title')} onBack={back} backLabel={t('common.back')} />
      <View style={styles.stack}>
        <Text variant="headingLg" role="heading">
          {account?.name ?? ''}
        </Text>
        {owes ? (
          <Text tone="muted">
            {overdue !== null && scaled(overdue, 2) > 0n
              ? t('collect.owes_overdue', {
                  outstanding: money(owes.outstanding),
                  overdue: money(overdue),
                })
              : t('collect.owes', { outstanding: money(owes.outstanding) })}
          </Text>
        ) : null}
      </View>

      {owes && scaled(owes.notInBooks, 2) > 0n ? (
        <Card style={styles.stack}>
          <Figure label={t('collections.not_in_books')} value={money(owes.notInBooks)} />
          <Figure label={t('collections.left_after')} value={money(owes.leftAfter)} />
        </Card>
      ) : null}

      {invoices && invoices.length > 0 ? (
        <ListGroup title={t('receivables.open_invoices')}>
          {invoices.map((invoice) => (
            <ListRow
              key={invoice.id}
              label={`${invoice.number} · ${money(invoice.open)}`}
              detail={
                invoice.daysPastDue === null
                  ? t('receivables.due_on', { date: formatDate(invoice.dueDate, { locale }) })
                  : t('receivables.days_late', { count: invoice.daysPastDue })
              }
              {...(invoice.daysPastDue !== null && invoice.daysPastDue > 90
                ? { tone: 'danger' as const }
                : {})}
            />
          ))}
        </ListGroup>
      ) : null}

      <TextField
        label={t('collections.amount')}
        required
        numeric
        keyboardType="decimal-pad"
        value={amount}
        onChangeText={setAmount}
        {...(tried && !valid
          ? { error: t('collect.issue_amount') }
          : shown('amount')
            ? { error: shown('amount')! }
            : {})}
      />
      {preview && preview.settles.length > 0 ? (
        <Notice tone="info">
          {t('collect.settles', {
            invoices: preview.settles
              .map((entry) => `${entry.invoice} (${money(entry.amount)})`)
              .join(', '),
          })}
          {scaled(preview.advance, 2) > 0n
            ? `\n${t('collect.advance', { amount: money(preview.advance) })}`
            : ''}
        </Notice>
      ) : null}

      <Text variant="labelMd" weight={600}>
        {t('collections.paid_by')}
      </Text>
      <ChipGroup
        label={t('collections.paid_by')}
        value={mode}
        onChange={setMode}
        choices={COLLECTION_MODES.map((entry) => ({
          value: entry,
          label: t(`collections.mode_${entry}`),
        }))}
      />

      {mode === 'cash' && overLimit && cashLimit !== null ? (
        <Notice tone="danger">
          {t('collect.cash_limit', { limit: money(cashLimit), taken: money(takenToday) })}
        </Notice>
      ) : null}

      {mode === 'upi' || mode === 'bank_transfer' ? (
        <TextField
          label={t('collect.reference')}
          help={t(mode === 'upi' ? 'collect.reference_help_upi' : 'collect.reference_help_bank')}
          required
          maxLength={60}
          autoCapitalize="characters"
          value={reference}
          onChangeText={setReference}
          {...(shown('reference_needed') ? { error: shown('reference_needed')! } : {})}
        />
      ) : null}

      {mode === 'cheque' ? (
        <View style={styles.stack}>
          <TextField
            label={t('collect.cheque_number')}
            required
            maxLength={20}
            keyboardType="number-pad"
            value={chequeNumber}
            onChangeText={setChequeNumber}
            {...(shown('cheque_number_needed') ? { error: shown('cheque_number_needed')! } : {})}
          />
          <TextField
            label={t('collect.cheque_bank')}
            required
            maxLength={80}
            value={chequeBank}
            onChangeText={setChequeBank}
            {...(shown('cheque_bank_needed') ? { error: shown('cheque_bank_needed')! } : {})}
          />
          <Text variant="labelMd" weight={600}>
            {t('collections.cheque_date')}
          </Text>
          <Text tone="muted">
            {t('collect.cheque_date_is', { date: formatDate(chequeDate, { locale }) })}
          </Text>
          <View style={styles.months}>
            <IconButton
              icon={ChevronLeft}
              label={t('attendance.previous')}
              onPress={() => setPeriod(shiftMonth(period, -1))}
            />
            <Text variant="headingMd" style={styles.month}>
              {formatMonth(period, { locale })}
            </Text>
            <IconButton
              icon={ChevronRight}
              label={t('attendance.next')}
              onPress={() => setPeriod(shiftMonth(period, 1))}
            />
          </View>
          <MonthDays
            dates={monthDates(period)}
            onPick={setChequeDate}
            look={(date) =>
              date === chequeDate
                ? {
                    label: t('claims.cell_chosen', { date: formatDate(date, { locale }) }),
                    tone: 'info',
                    selected: true,
                  }
                : { label: formatDate(date, { locale }) }
            }
          />
          <Text tone="muted">{t('collect.photo_count', { count: photos.length })}</Text>
          {shown('cheque_photo_needed') ? (
            <Text tone="danger" role="alert">
              {shown('cheque_photo_needed')}
            </Text>
          ) : null}
          {photos.length < 3 ? (
            <Button
              variant="secondary"
              icon={Camera}
              label={t('collect.take_photo')}
              onPress={photograph}
            />
          ) : null}
        </View>
      ) : null}

      <TextField
        label={t('collections.note')}
        help={t('collect.note_help')}
        maxLength={500}
        multiline
        value={note}
        onChangeText={setNote}
      />

      {failure ? (
        <Text tone="danger" role="alert">
          {failure}
        </Text>
      ) : null}
    </Screen>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <Text tone="muted" style={styles.grow}>
        {label}
      </Text>
      <Text weight={600} style={styles.amount}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  grow: { flex: 1 },
  figure: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  amount: { fontVariant: ['tabular-nums'] },
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { flex: 1, textAlign: 'center' },
});
