import { spacing } from '@thelamp/design-tokens';
import { formatDate, formatMonth } from '@thelamp/i18n';
import {
  type CalendarResult,
  datesBetween,
  LEAVE_REASON_MAX,
  leaveDays,
  newId,
  todayIn,
} from '@thelamp/shared';
import { Button, Card, ChoiceGroup, Notice, Screen, Text, TextField } from '@thelamp/ui-mobile';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Camera, ChevronLeft, ChevronRight, RotateCw, Send } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { takeResults } from '../capture-results';
import { useConfig, useMe } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import {
  type Asked,
  offDays,
  previewLeave,
  queueLeave,
  useCalendars,
  useLeaveTypes,
  useMyLeave,
  useQueuedLeave,
} from '../leave';
import { useSync } from '../sync';
import { MonthDays, monthDates, shiftMonth } from './month-days';

const DOCUMENT_REQUEST = 'leave-document';

/** A tenant's calendars for two years as one, each calendar with both years' holidays. */
function joined(a: readonly CalendarResult[], b: readonly CalendarResult[]): CalendarResult[] {
  return a.map((calendar) => ({
    ...calendar,
    holidays: [
      ...calendar.holidays,
      ...(b.find((other) => other.key === calendar.key)?.holidays ?? []),
    ],
  }));
}

/**
 * Asking for leave on the phone (spec 8.1 Me, M13, BR-27): a type with its balance, the first
 * and last days picked on a month with days off dimmed, a half day where the type allows, a reason,
 * and a document past the type's days. The phone counts the working days and checks what the
 * server would refuse from what it keeps; the request queues and waits for a signal.
 */
export function NewLeaveScreen() {
  const { t, locale } = useLanguage();
  const { client } = useApp();
  const sync = useSync();
  const config = useConfig();
  const me = useMe();
  const settings = config.data?.bundle.settings;
  const today = todayIn(settings?.timezone ?? 'Asia/Kolkata');
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [typeKey, setTypeKey] = useState<string>();
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [attachmentId, setAttachmentId] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const waitingForDocument = useRef(false);

  const types = useLeaveTypes();
  const active = (types.data ?? []).filter((type) => type.active);
  const type = active.find((entry) => entry.key === typeKey) ?? active[0];
  const last = end ?? start;
  const firstYear = (start ?? period).slice(0, 4);
  const lastYear = (last ?? period).slice(0, 4);
  const calendarsA = useCalendars(firstYear);
  const calendarsB = useCalendars(lastYear);
  const mine = useMyLeave(firstYear);
  const queued = useQueuedLeave();
  const calendars =
    firstYear === lastYear
      ? (calendarsA.data ?? [])
      : joined(calendarsA.data ?? [], calendarsB.data ?? []);
  const isOff = offDays(calendars, me.data?.calendarKey ?? null);
  const asked: Asked[] = [
    ...(mine.data ?? []),
    ...queued.map((request) => ({
      ...request,
      days: leaveDays(
        { start: request.startDate, end: request.endDate, halfDay: request.halfDay },
        isOff,
      ),
      state: 'pending' as const,
    })),
  ];
  const half = halfDay && Boolean(type?.halfDayAllowed) && start !== null && last === start;
  const preview =
    type && start && last && settings
      ? previewLeave({
          type,
          startDate: start,
          endDate: last,
          halfDay: half,
          hasAttachment: attachmentId !== undefined,
          isOff,
          asked,
          financialYearStartMonth: settings.financialYearStartMonth,
        })
      : null;
  const needsDocument =
    attachmentId !== undefined ||
    (preview?.issues.some((issue) => issue.issue === 'attachment_required') ?? false);

  // Back from the camera with the document.
  useFocusEffect(
    useCallback(() => {
      if (!waitingForDocument.current) return;
      const [mediaId] = takeResults(DOCUMENT_REQUEST);
      if (!mediaId) return;
      waitingForDocument.current = false;
      setAttachmentId(mediaId);
    }, []),
  );

  function pick(date: string) {
    if (start === null || end !== null || date < start) {
      setStart(date);
      setEnd(null);
    } else {
      setEnd(date);
    }
  }

  async function send() {
    if (!sync || !client.owner || !type || !start || !last || !preview) return;
    if (preview.issues.length > 0) return;
    setBusy(true);
    setFailure(undefined);
    try {
      await queueLeave(sync, client.owner, {
        id: newId(),
        leaveType: type.key,
        startDate: start,
        endDate: last,
        halfDay: half,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(attachmentId ? { attachmentId } : {}),
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

  const chosen = new Set(start && last && last >= start ? datesBetween(start, last) : []);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/leave'))}
      />
      <Text variant="headingXl" role="heading">
        {t('leave.new_title')}
      </Text>

      {!types.data ? (
        types.isError ? (
          <View style={styles.stack}>
            <Text tone="danger" role="alert">
              {errorMessage(types.error, t)}
            </Text>
            <Button
              variant="secondary"
              icon={RotateCw}
              label={t('common.retry')}
              onPress={() => void types.refetch()}
            />
          </View>
        ) : (
          <Text tone="muted">{t('common.loading')}</Text>
        )
      ) : (
        <>
          <ChoiceGroup
            title={t('leave.type')}
            value={type?.key ?? ''}
            onChange={(key) => {
              setTypeKey(key);
              setHalfDay(false);
            }}
            choices={active.map((entry) => ({ value: entry.key, label: entry.name[locale] }))}
          />

          <Text tone="muted">{t('leave.pick_days')}</Text>
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
              onPress={() => setPeriod(shiftMonth(period, 1))}
            />
          </View>
          <MonthDays
            dates={monthDates(period)}
            onPick={pick}
            look={(date) => {
              const shown = formatDate(date, { locale });
              if (chosen.has(date)) {
                return {
                  label: t('leave.cell_chosen', { date: shown }),
                  tone: isOff(date) ? 'neutral' : 'info',
                  selected: true,
                };
              }
              return isOff(date)
                ? { label: t('leave.cell_off', { date: shown }), tone: 'neutral' }
                : { label: shown };
            }}
          />

          {start ? (
            <Card style={styles.stack}>
              <Text variant="headingMd">
                {last && last !== start
                  ? t('leave.dates', {
                      from: formatDate(start, { locale }),
                      to: formatDate(last, { locale }),
                    })
                  : formatDate(start, { locale })}
              </Text>
              {type?.halfDayAllowed && last === start ? (
                <ChoiceGroup
                  title={t('leave.day_part')}
                  value={halfDay ? 'half' : 'whole'}
                  onChange={(value) => setHalfDay(value === 'half')}
                  choices={[
                    { value: 'whole', label: t('leave.whole_day') },
                    { value: 'half', label: t('leave.half') },
                  ]}
                />
              ) : null}
              {preview ? (
                <Text weight={600}>{t('leave.working_days', { count: preview.days })}</Text>
              ) : null}
              {preview?.issues
                .filter((issue) => issue.issue !== 'attachment_required')
                .map((issue) => (
                  <Text key={issue.issue} tone="danger" role="alert">
                    {t(`leave.issue_${issue.issue}`)}
                  </Text>
                ))}
            </Card>
          ) : null}

          {needsDocument ? (
            <View style={styles.stack}>
              {attachmentId ? (
                <Notice>{t('leave.document_taken')}</Notice>
              ) : (
                <Notice>{t('leave.document_needed')}</Notice>
              )}
              <Button
                variant="secondary"
                icon={Camera}
                label={t('leave.take_document')}
                onPress={() => {
                  waitingForDocument.current = true;
                  router.push({
                    pathname: '/camera',
                    params: { kind: 'attachment', request: DOCUMENT_REQUEST },
                  });
                }}
              />
            </View>
          ) : null}

          <TextField
            label={t('leave.reason')}
            help={t('leave.reason_help')}
            multiline
            maxLength={LEAVE_REASON_MAX}
            value={reason}
            onChangeText={setReason}
          />
          {failure ? (
            <Text tone="danger" role="alert">
              {failure}
            </Text>
          ) : null}
          <Button
            variant="primary"
            icon={Send}
            label={t('leave.send')}
            busy={busy}
            disabled={!preview || preview.issues.length > 0 || !sync}
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
