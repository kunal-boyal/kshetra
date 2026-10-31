import { formatNumber } from '@thelamp/i18n';
import {
  type LeaveBalance,
  LeaveBalanceResult,
  type LeaveRequestResult,
  LeaveRequestListResult,
  LeaveTypeListResult,
  todayIn,
} from '@thelamp/shared';
import {
  type BadgeVariant,
  type Column,
  DataTable,
  EmptyState,
  Icon,
  SegmentedControl,
  StatusBadge,
} from '@thelamp/ui-web';
import { useQuery } from '@tanstack/react-query';
import { CalendarX } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess } from './data';
import { Section, useDates } from './shared';

const STATE_BADGE: Record<LeaveRequestResult['state'], BadgeVariant> = {
  pending: 'pending',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/**
 * A person's leave (M13, decision D81): each active type's balance in its quota year, credited,
 * carried in and, for the year before, lapsed (D114), and the requests starting this year with
 * their state. People ask for leave on the phone.
 */
export function LeaveSection({ userId }: { userId: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const today = todayIn(access.timezone);
  const year = today.slice(0, 4);
  // This quota year, or the one before, read on the same day a year back (D114).
  const [which, setWhich] = useState<'this' | 'last'>('this');
  const on =
    which === 'this'
      ? today
      : new Date(Date.UTC(Number(year) - 1, Number(today.slice(5, 7)) - 1, Number(today.slice(8))))
          .toISOString()
          .slice(0, 10);
  const types = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => read(client, '/v1/leave-types', LeaveTypeListResult),
  });
  const balances = useQuery({
    queryKey: ['leave-balances', userId, on],
    queryFn: () => read(client, `/v1/leave-balances?userId=${userId}&on=${on}`, LeaveBalanceResult),
  });
  const requests = useQuery({
    queryKey: ['leave-requests', userId, year],
    queryFn: () =>
      read(client, `/v1/leave-requests?userId=${userId}&year=${year}`, LeaveRequestListResult),
  });
  const names = new Map(
    (types.data?.items ?? []).map((type) => [type.key, type.name[locale]] as const),
  );
  const nameOf = (key: string) => names.get(key) ?? key;
  const number = (value: number) => formatNumber(value, { locale }, { maximumFractionDigits: 1 });
  const failed = types.error ?? balances.error ?? requests.error;

  const balanceColumns: Column<LeaveBalance>[] = [
    { key: 'type', header: t('leave.col_type'), render: (row) => nameOf(row.leaveType) },
    {
      key: 'year',
      header: t('leave.col_year'),
      render: (row) => t('leave.dates', { from: dates.date(row.from), to: dates.date(row.to) }),
    },
    {
      key: 'quota',
      header: t('leave.col_quota'),
      align: 'end',
      render: (row) => (row.quota === null ? t('leave.no_limit') : number(row.quota)),
    },
    {
      key: 'credited',
      header: t('leave.col_credited'),
      align: 'end',
      render: (row) => (row.credited === null ? '—' : number(row.credited)),
    },
    {
      key: 'carried',
      header: t('leave.col_carried'),
      align: 'end',
      render: (row) => (row.quota === null ? '—' : number(row.carriedIn)),
    },
    {
      key: 'approved',
      header: t('leave.col_approved'),
      align: 'end',
      render: (row) => number(row.approved),
    },
    {
      key: 'pending',
      header: t('leave.col_pending'),
      align: 'end',
      render: (row) => number(row.pending),
    },
    {
      key: 'available',
      header: t('leave.col_available'),
      align: 'end',
      render: (row) => (row.available === null ? '—' : number(row.available)),
    },
    // Days lapse only when a year ends, so the year before shows them.
    ...(which === 'last'
      ? [
          {
            key: 'lapsed',
            header: t('leave.col_lapsed'),
            align: 'end',
            render: (row) => (row.quota === null ? '—' : number(row.lapsed)),
          } satisfies Column<LeaveBalance>,
        ]
      : []),
  ];
  const requestColumns: Column<LeaveRequestResult>[] = [
    {
      key: 'dates',
      header: t('leave.col_dates'),
      render: (row) =>
        row.startDate === row.endDate
          ? dates.date(row.startDate)
          : t('leave.dates', { from: dates.date(row.startDate), to: dates.date(row.endDate) }),
    },
    { key: 'type', header: t('leave.col_type'), render: (row) => nameOf(row.leaveType) },
    {
      key: 'days',
      header: t('leave.col_days'),
      align: 'end',
      render: (row) => (row.halfDay ? t('leave.half') : number(row.days)),
    },
    {
      key: 'state',
      header: t('leave.col_state'),
      render: (row) => (
        <StatusBadge variant={STATE_BADGE[row.state]}>
          {t(`approval.status_${row.state}`)}
        </StatusBadge>
      ),
    },
  ];

  return (
    <Section title={t('leave.title')}>
      {failed ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failed, t)}
        </p>
      ) : !balances.data || !requests.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          <SegmentedControl
            label={t('leave.balance_year')}
            value={which}
            onChange={setWhich}
            choices={[
              { value: 'this', label: t('leave.this_year') },
              { value: 'last', label: t('leave.last_year') },
            ]}
          />
          <DataTable
            caption={t('leave.balances')}
            columns={balanceColumns}
            rows={balances.data.items}
            rowKey={(row) => row.leaveType}
          />
          <DataTable
            caption={t('leave.requests')}
            columns={requestColumns}
            rows={requests.data.items}
            rowKey={(row) => row.id}
            empty={
              <EmptyState icon={<Icon icon={CalendarX} />} title={t('leave.none_title')}>
                {t('leave.none_body')}
              </EmptyState>
            }
          />
        </>
      )}
    </Section>
  );
}
