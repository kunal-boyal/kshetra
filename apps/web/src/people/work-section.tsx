import { formatNumber } from '@kshetra/i18n';
import { AttendanceResult, type ShiftResult, ShiftListResult, todayIn } from '@kshetra/shared';
import { type Column, DataTable, EmptyState, Icon, StatusBadge } from '@kshetra/ui-web';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess } from './data';
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
 * A person's work (M5): this month's attendance so far, and their shifts, newest first, with
 * time on duty, distance and how each ended. The live map and day replay come with maps (M17).
 */
export function WorkSection({ userId }: { userId: string }) {
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
          ]}
        />
      ) : null}
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
