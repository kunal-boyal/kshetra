import { formatNumber } from '@thelamp/i18n';
import {
  AttendanceResult,
  type ShiftResult,
  ShiftListResult,
  todayIn,
  UserCalendarResult,
} from '@thelamp/shared';
import {
  type Column,
  DataTable,
  EmptyState,
  Icon,
  Notice,
  SelectField,
  StatusBadge,
} from '@thelamp/ui-web';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { useCalendars } from '../settings/data';
import { read, useAccess, write } from './data';
import { Facts, Section, useDates } from './shared';

function useShifts(userId: string) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['shifts', userId],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/shifts?userId=${userId}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        ShiftListResult,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

function useAttendance(userId: string, period: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['attendance', userId, period],
    queryFn: () =>
      read(client, `/v1/attendance?userId=${userId}&period=${period}`, AttendanceResult),
  });
}

/**
 * A person's work (M5): this month's attendance so far, with the days they work and are paid for
 * (BR-24, BR-25) and the holiday calendar they keep (M13), and their shifts, newest first, with
 * time on duty, distance and how each ended. The live map and day replay come with maps (M17).
 */
export function WorkSection({
  userId,
  calendarKey,
}: {
  userId: string;
  calendarKey: string | null;
}) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const period = todayIn(access.timezone).slice(0, 7);
  const attendance = useAttendance(userId, period);
  const shifts = useShifts(userId);
  const rows = shifts.data?.pages.flatMap((page) => page.items) ?? [];
  const counted = (attendance.data?.days ?? []).filter(
    (day) => day.status !== 'future' && day.status !== 'not_employed',
  );
  const count = (status: string) => counted.filter((day) => day.status === status).length;
  const hours = counted.reduce((total, day) => total + day.hours, 0);
  const duration = (seconds: number | null) =>
    seconds === null
      ? '—'
      : t('work.duration', {
          hours: Math.floor(seconds / 3_600),
          minutes: Math.floor((seconds % 3_600) / 60),
        });

  const columns: Column<ShiftResult>[] = [
    {
      key: 'started',
      header: t('work.started'),
      render: (shift) => dates.dateTime(shift.startedAt),
    },
    {
      key: 'ended',
      header: t('work.ended'),
      render: (shift) =>
        shift.endedAt ? (
          dates.dateTime(shift.endedAt)
        ) : (
          <StatusBadge variant="success">{t('work.on_shift')}</StatusBadge>
        ),
    },
    {
      key: 'duty',
      header: t('work.on_duty'),
      align: 'end',
      render: (shift) => duration(shift.onDutySeconds),
    },
    {
      key: 'distance',
      header: t('work.distance'),
      align: 'end',
      render: (shift) =>
        shift.distanceM === null
          ? '—'
          : t('work.km', {
              km: formatNumber(shift.distanceM / 1_000, { locale }, { maximumFractionDigits: 1 }),
            }),
    },
    {
      key: 'how',
      header: t('work.how_ended'),
      render: (shift) => (
        <span className="flex flex-wrap gap-1">
          {shift.endReason ? (
            <StatusBadge variant={shift.endReason === 'punch_out' ? 'neutral' : 'pending'}>
              {t(`work.end_${shift.endReason}`)}
            </StatusBadge>
          ) : null}
          {shift.pauses.length > 0 ? (
            <StatusBadge variant="info">
              {t('work.pauses', { count: shift.pauses.length })}
            </StatusBadge>
          ) : null}
          {shift.flags.includes('clock_skew') ? (
            <StatusBadge variant="danger">{t('work.clock_skew')}</StatusBadge>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <Section title={t('work.title')}>
      {attendance.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(attendance.error, t)}
        </p>
      ) : attendance.data ? (
        <Facts
          items={[
            [t('work.present'), formatNumber(count('present'), { locale })],
            [t('work.half_day'), formatNumber(count('half_day'), { locale })],
            [t('work.absent'), formatNumber(count('absent'), { locale })],
            [t('work.hours'), formatNumber(hours, { locale }, { maximumFractionDigits: 1 })],
            [t('work.scheduled'), formatNumber(attendance.data.summary.scheduled, { locale })],
            [t('work.paid'), formatNumber(attendance.data.summary.paid, { locale })],
          ]}
        />
      ) : null}
      <CalendarChoice userId={userId} calendarKey={calendarKey} />
      <p className="ks-muted">{t('work.month_note')}</p>
      {shifts.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(shifts.error, t)}
        </p>
      ) : shifts.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('work.shifts')}
          columns={columns}
          rows={rows}
          rowKey={(shift) => shift.id}
          empty={
            <EmptyState icon={<Icon icon={Clock} />} title={t('work.no_shifts_title')}>
              {t('work.no_shifts_body')}
            </EmptyState>
          }
          {...(shifts.hasNextPage
            ? {
                more: {
                  label: t('common.load_more'),
                  busy: shifts.isFetchingNextPage,
                  onClick: () => void shifts.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
    </Section>
  );
}

/** The holiday calendar a person keeps; those who manage calendars may change it. */
function CalendarChoice({ userId, calendarKey }: { userId: string; calendarKey: string | null }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const queryClient = useQueryClient();
  const calendars = useCalendars();
  const [failure, setFailure] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const items = calendars.data?.items ?? [];
  const fallback = items.find((calendar) => calendar.default);
  if (items.length === 0) return null;
  const options = [
    {
      value: '',
      label: t('work.calendar_default', { name: fallback ? fallback.name[locale] : '—' }),
    },
    ...items.map((calendar) => ({ value: calendar.key, label: calendar.name[locale] })),
  ];

  async function choose(value: string) {
    setFailure(undefined);
    setSaved(false);
    try {
      await write(client, 'PUT', `/v1/users/${userId}/calendar`, UserCalendarResult, {
        calendarKey: value || null,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['user', userId] }),
        queryClient.invalidateQueries({ queryKey: ['attendance', userId] }),
      ]);
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-2">
      <SelectField
        label={t('work.calendar')}
        value={calendarKey ?? ''}
        disabled={!access.can('calendar.manage')}
        options={options}
        {...(failure !== undefined ? { error: errorMessage(failure, t) } : {})}
        onChange={(event) => void choose(event.target.value)}
      />
      {saved ? <Notice>{t('work.calendar_saved')}</Notice> : null}
    </div>
  );
}
