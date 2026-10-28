import { formatDate, formatMonth, formatNumber } from '@thelamp/i18n';
import { type ApprovalResult, LeaveTypeListResult, todayIn } from '@thelamp/shared';
import {
  Button,
  EmptyState,
  Icon,
  PageHeader,
  PeriodStepper,
  SelectField,
  StatusBadge,
  Tabs,
  tabPanelProps,
  Pager,
} from '@thelamp/ui-web';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CalendarCheck, CalendarDays, Download } from 'lucide-react';
import { useId, useState } from 'react';
import { useApp } from '../context';
import { useInbox } from '../approvals/data';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, useTerritories } from '../people/data';
import { monthDates } from '../planning/plan-days';
import { useStartExport } from '../reports/data';
import { LETTER_TONE, LETTERS, letterOf, useRegister, useTeamLeave } from './data';
import { useQueryPaging } from '../paging';

type View = 'register' | 'leave';

/**
 * Attendance (decision D104): everyone the viewer sees by days of a month, each day a letter by
 * the tenant's rule, with their present days' total; the team's leave in the month; and the leave
 * and fixes waiting for the viewer's decision. The register exports as the attendance report.
 */
export function AttendancePage() {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const territories = useTerritories();
  const startExport = useStartExport();
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const [territoryId, setTerritoryId] = useState('');
  const [view, setView] = useState<View>('register');
  const [exporting, setExporting] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const month = formatMonth(period, { locale });

  async function exportRegister() {
    setExporting(true);
    setFailure(undefined);
    try {
      await startExport({
        report: 'attendance_register',
        format: 'xlsx',
        locale,
        filters: { period, ...(territoryId ? { territoryId } : {}) },
      });
      await navigate({ to: '/reports' });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('attendance.register_title', { month })}
        meta={t('attendance.meta')}
        actions={
          <>
            {access.can('calendar.manage') ? (
              <Link to="/settings/calendars" className="ks-btn secondary sm">
                <Icon icon={CalendarDays} size="sm" />
                {t('attendance.holidays')}
              </Link>
            ) : null}
            {access.can('report.view') ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Icon icon={Download} />}
                busy={exporting}
                onClick={() => void exportRegister()}
              >
                {t('attendance.export')}
              </Button>
            ) : null}
          </>
        }
        toolbar={
          <>
            <PeriodStepper
              value={period}
              onChange={setPeriod}
              format={(value) => formatMonth(value, { locale })}
              label={t('plan.month')}
              previousLabel={t('targets.previous_month')}
              nextLabel={t('targets.next_month')}
            />
            <ul className="flex flex-wrap gap-2" aria-label={t('attendance.key')}>
              {LETTERS.map((letter) => (
                <li
                  key={letter}
                  className={`inline-flex items-center gap-1.5 rounded-[var(--radius-full)] border px-2.5 py-0.5 text-xs font-semibold ${LETTER_TONE[letter]}`}
                >
                  <span aria-hidden="true">{t(`attendance.letter_${letter}`)}</span>
                  {t(`attendance.status_${letter}`)}
                </li>
              ))}
            </ul>
          </>
        }
      />
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Tabs<View>
              label={t('attendance.views')}
              idPrefix="attendance"
              value={view}
              onChange={setView}
              choices={[
                { value: 'register', label: t('attendance.view_register') },
                { value: 'leave', label: t('attendance.view_leave') },
              ]}
            />
            {view === 'register' ? (
              <SelectField
                label={t('people.territory')}
                className="min-w-56"
                value={territoryId}
                none={t('common.any')}
                options={(territories.data ?? []).map((territory) => ({
                  value: territory.id,
                  label: `${territory.name} (${territory.code})`,
                }))}
                onChange={(event) => setTerritoryId(event.target.value)}
              />
            ) : null}
          </div>
          <div {...tabPanelProps('attendance', view)} className="min-w-0">
            {view === 'register' ? (
              <Register period={period} territoryId={territoryId} month={month} />
            ) : (
              <TeamLeave period={period} month={month} />
            )}
          </div>
        </div>
        {access.can('approval.act') ? <Waiting /> : null}
      </div>
    </div>
  );
}

/** The register: a row a person, a letter a day, and the present days' total. */
function Register({
  period,
  territoryId,
  month,
}: {
  period: string;
  territoryId: string;
  month: string;
}) {
  const { t, locale } = useLanguage();
  const register = useRegister(period, territoryId);
  const rows = register.data?.pages.flatMap((page) => page.items) ?? [];
  const paging = useQueryPaging(rows.length, register, rows[0]?.user.id);
  const dates = monthDates(period);
  if (register.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(register.error, t)}
      </p>
    );
  }
  if (register.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  if (rows.length === 0) {
    return (
      <EmptyState icon={<Icon icon={CalendarCheck} />} title={t('attendance.empty_title')}>
        {t('attendance.empty_body')}
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative overflow-x-auto rounded-[var(--radius-lg)]"
        role="region"
        aria-label={t('attendance.register_caption', { month })}
        tabIndex={0}
      >
        <table className="ks-table">
          <caption className="sr-only">{t('attendance.register_caption', { month })}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1]">
                {t('attendance.person')}
              </th>
              {dates.map((date) => (
                <th key={date} scope="col" className="px-1! text-center tabular-nums">
                  {Number(date.slice(8, 10))}
                </th>
              ))}
              <th scope="col" className="r">
                {t('attendance.present_total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((_, index) => paging.onPage(index))
              .map((row) => (
                <tr key={row.user.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] bg-[var(--surface)]! whitespace-nowrap!"
                  >
                    {row.user.name}
                  </th>
                  {row.days.map((day) => {
                    const letter = letterOf(day.status);
                    return (
                      <td key={day.date} className="px-0.5! text-center">
                        {letter ? (
                          <span
                            className={`inline-flex size-6 items-center justify-center rounded-[var(--radius-sm)] border text-xs font-semibold ${LETTER_TONE[letter]}`}
                          >
                            <span aria-hidden="true">{t(`attendance.letter_${letter}`)}</span>
                            <span className="sr-only">{t(`attendance.status_${letter}`)}</span>
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                  <td className="r font-semibold">
                    {formatNumber(row.present, { locale }, { maximumFractionDigits: 1 })}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <Pager paging={paging} />
    </div>
  );
}

const LEAVE_BADGE = {
  pending: 'waiting',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
} as const;

/** The team's leave that takes in a day of the month, by its first day. */
function TeamLeave({ period, month }: { period: string; month: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const leave = useTeamLeave(period);
  const types = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => read(client, '/v1/leave-types', LeaveTypeListResult),
  });
  if (leave.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(leave.error, t)}
      </p>
    );
  }
  if (!leave.data) return <p className="ks-muted">{t('common.loading')}</p>;
  if (leave.data.items.length === 0) {
    return (
      <EmptyState icon={<Icon icon={CalendarDays} />} title={t('attendance.leave_empty')}>
        {t('attendance.leave_empty_body')}
      </EmptyState>
    );
  }
  const names = new Map(leave.data.people.map((person) => [person.id, person.name]));
  const typeName = (key: string) =>
    types.data?.items.find((type) => type.key === key)?.name[locale] ?? key;
  const day = (date: string) => formatDate(date, { locale });
  return (
    <div
      className="relative overflow-x-auto"
      role="region"
      aria-label={t('attendance.leave_caption', { month })}
      tabIndex={0}
    >
      <table className="ks-table">
        <caption className="sr-only">{t('attendance.leave_caption', { month })}</caption>
        <thead>
          <tr>
            <th scope="col">{t('attendance.person')}</th>
            <th scope="col">{t('attendance.leave_type')}</th>
            <th scope="col">{t('attendance.leave_dates')}</th>
            <th scope="col" className="r">
              {t('attendance.leave_days')}
            </th>
            <th scope="col">{t('attendance.leave_state')}</th>
          </tr>
        </thead>
        <tbody>
          {leave.data.items.map((request) => (
            <tr key={request.id}>
              <th scope="row">{names.get(request.userId) ?? '—'}</th>
              <td>{typeName(request.leaveType)}</td>
              <td className="whitespace-nowrap">
                {request.startDate === request.endDate
                  ? day(request.startDate)
                  : `${day(request.startDate)} – ${day(request.endDate)}`}
              </td>
              <td className="r">
                {formatNumber(request.days, { locale }, { maximumFractionDigits: 1 })}
              </td>
              <td>
                <StatusBadge variant={LEAVE_BADGE[request.state]}>
                  {t(`attendance.leave_state_${request.state}`)}
                </StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Leave and fixes waiting for the viewer's decision, each opening the approvals inbox. */
function Waiting() {
  const { t, locale } = useLanguage();
  const headingId = useId();
  const leave = useInbox('leave');
  const fixes = useInbox('regularisation');
  const items: ApprovalResult[] = [
    ...(leave.data?.pages.flatMap((page) => page.items) ?? []),
    ...(fixes.data?.pages.flatMap((page) => page.items) ?? []),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const counts = leave.data?.pages[0]?.counts ?? fixes.data?.pages[0]?.counts ?? {};
  const total = (counts.leave ?? 0) + (counts.regularisation ?? 0);
  return (
    <section className="ks-card flex min-w-0 flex-col gap-3" aria-labelledby={headingId}>
      <h2 id={headingId} className="heading-md">
        {t('attendance.waiting', { n: formatNumber(total, { locale }) })}
      </h2>
      {leave.isPending || fixes.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="ks-muted">{t('attendance.waiting_none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to="/approvals"
                search={{ type: item.requestType }}
                className="ks-spread gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3 hover:bg-[var(--surface-sunken)]"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">
                    {item.requester.name} · {item.subject.title}
                  </span>
                  <span className="ks-meta">
                    {item.steps
                      .find((step) => step.status === 'pending')
                      ?.approvers.map((person) => person.name)
                      .join(', ') ?? ''}
                  </span>
                </span>
                <StatusBadge variant={item.requestType === 'leave' ? 'info' : 'pending'}>
                  {t(
                    item.requestType === 'leave' ? 'attendance.kind_leave' : 'attendance.kind_fix',
                  )}
                </StatusBadge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
