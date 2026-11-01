import { formatDate, formatNumber } from '@thelamp/i18n';
import {
  type ExportFormat,
  type ExportReport,
  type ReportFilters,
  type ReportScheduleResult,
  type ReportScheduleRun,
  type ScheduleFilters,
  type ScheduleFrequency,
} from '@thelamp/shared';
import {
  Button,
  ChipList,
  type Column,
  Confirm,
  DataTable,
  EmptyState,
  Icon,
  Notice,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { CalendarClock, Mail } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { useMe } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useUsers } from '../people/data';
import { fieldErrors } from '../people/shared';
import { useSchedule, useScheduleChanges, useSchedules } from './data';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** When a schedule sends, in words: "Mondays at 08:00" or "On the 1st at 07:30". */
function useWhen() {
  const { t } = useLanguage();
  return (schedule: Pick<ReportScheduleResult, 'frequency' | 'weekday' | 'at'>) =>
    schedule.frequency === 'weekly'
      ? t('schedule.when_weekly', {
          day: t(`plan.weekday_${(schedule.weekday ?? 1) as (typeof WEEKDAYS)[number]}`),
          at: schedule.at,
        })
      : t('schedule.when_monthly', { at: schedule.at });
}

/**
 * Schedules a report, or changes a schedule (decision D122): its file, how often and when, its
 * language, and who gets it. Each recipient gets it as they may see it, so the form says so.
 */
export function ScheduleForm({
  report,
  filters,
  schedule,
  onDone,
  onSaved = onDone,
}: {
  report: ExportReport;
  filters: ReportFilters | ScheduleFilters;
  schedule?: ReportScheduleResult;
  onDone: () => void;
  onSaved?: () => void;
}) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const me = useMe(client).data;
  const people = useUsers({ status: 'active' }, 200);
  const changes = useScheduleChanges();
  const [format, setFormat] = useState<ExportFormat>(schedule?.format ?? 'xlsx');
  const [frequency, setFrequency] = useState<ScheduleFrequency>(schedule?.frequency ?? 'weekly');
  const [weekday, setWeekday] = useState(schedule?.weekday ?? 1);
  const [at, setAt] = useState(schedule?.at ?? '08:00');
  const [language, setLanguage] = useState(schedule?.locale ?? locale);
  const [recipients, setRecipients] = useState<{ id: string; label: string }[]>(
    schedule?.recipients.map((person) => ({ id: person.id, label: person.name })) ??
      (me ? [{ id: me.userId, label: me.name }] : []),
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = fieldErrors(failure);
  const options = (people.data?.pages.flatMap((page) => page.items) ?? [])
    .filter((person) => !recipients.some((chosen) => chosen.id === person.id))
    .map((person) => ({ value: person.id, label: `${person.name} (${person.code})` }));
  const recipientError = Object.entries(errors).find(([path]) =>
    path.startsWith('recipients'),
  )?.[1];
  // A schedule keeps the filters but not the month, which each send works out (BR-52).
  const kept: ScheduleFilters = Object.fromEntries(
    Object.entries(filters).filter(([key]) => key !== 'period'),
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    const timing = {
      format: report === 'workbook' ? ('xlsx' as const) : format,
      frequency,
      weekday: frequency === 'weekly' ? weekday : null,
      at,
      locale: language,
      recipients: recipients.map((person) => person.id),
    };
    try {
      if (schedule) await changes.update(schedule.id, timing);
      else await changes.create({ report, filters: kept, ...timing });
      onSaved();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ks-card flex flex-col gap-4" onSubmit={(event) => void save(event)}>
      <h3 className="heading-sm">
        {t(schedule ? 'schedule.change_title' : 'schedule.new_title', {
          report: t(`report.name_${report}`),
        })}
      </h3>
      <p className="ks-muted">{t('schedule.each_own')}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {report !== 'workbook' ? (
          <SelectField
            label={t('schedule.format')}
            value={format}
            options={[
              { value: 'xlsx', label: t('report.export_xlsx') },
              { value: 'csv', label: t('report.export_csv') },
            ]}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
          />
        ) : null}
        <SelectField
          label={t('schedule.frequency')}
          value={frequency}
          options={[
            { value: 'weekly', label: t('schedule.weekly') },
            { value: 'monthly', label: t('schedule.monthly') },
          ]}
          help={t(frequency === 'weekly' ? 'schedule.weekly_help' : 'schedule.monthly_help')}
          onChange={(event) => setFrequency(event.target.value as ScheduleFrequency)}
        />
        {frequency === 'weekly' ? (
          <SelectField
            label={t('schedule.weekday')}
            value={String(weekday)}
            options={WEEKDAYS.map((day) => ({
              value: String(day),
              label: t(`plan.weekday_${day}`),
            }))}
            {...(errors.weekday ? { error: errors.weekday } : {})}
            onChange={(event) => setWeekday(Number(event.target.value))}
          />
        ) : null}
        <TextField
          label={t('schedule.at')}
          type="time"
          value={at}
          required
          {...(errors.at ? { error: errors.at } : {})}
          onChange={(event) => setAt(event.target.value)}
        />
        <SelectField
          label={t('schedule.language')}
          value={language}
          options={[
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'हिन्दी' },
          ]}
          onChange={(event) => setLanguage(event.target.value as 'en' | 'hi')}
        />
      </div>
      <div className="flex flex-col gap-2">
        <SelectField
          label={t('schedule.add_recipient')}
          none={t('schedule.choose_person')}
          value=""
          options={options}
          {...(recipientError ? { error: recipientError } : {})}
          onChange={(event) => {
            const chosen = options.find((option) => option.value === event.target.value);
            if (chosen)
              setRecipients((list) => [...list, { id: chosen.value, label: chosen.label }]);
          }}
        />
        {recipients.length > 0 ? (
          <ChipList
            label={t('schedule.recipients')}
            items={recipients.map((person) => person.label)}
            removeLabel={(name) => t('schedule.remove_recipient', { name })}
            onRemove={(name) =>
              setRecipients((list) => list.filter((person) => person.label !== name))
            }
          />
        ) : (
          <p className="ks-help">{t('schedule.none_chosen')}</p>
        )}
      </div>
      {failure !== undefined && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy || recipients.length === 0}>
          {t(schedule ? 'schedule.save' : 'schedule.create')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** A schedule's latest sends: when, which month, and how each recipient's export went. */
function Runs({ id }: { id: string }) {
  const { t, locale } = useLanguage();
  const detail = useSchedule(id);
  const columns: Column<ReportScheduleRun>[] = [
    {
      key: 'date',
      header: t('schedule.sent_on'),
      render: (run) => formatDate(run.sendDate, { locale }),
    },
    { key: 'period', header: t('plan.month'), render: (run) => run.period },
    {
      key: 'exports',
      header: t('schedule.outcomes'),
      render: (run) => (
        <ul className="flex flex-col gap-1">
          {run.exports.map((entry) => (
            <li key={entry.user.id} className="flex flex-wrap items-center gap-2">
              <span>{entry.user.name}</span>
              <StatusBadge
                variant={
                  entry.status === 'ready'
                    ? 'success'
                    : entry.status === 'failed'
                      ? 'danger'
                      : entry.status === 'expired'
                        ? 'neutral'
                        : 'pending'
                }
              >
                {t(`report.export_status_${entry.status}`)}
              </StatusBadge>
              {entry.rows !== null ? (
                <span className="ks-muted text-sm">
                  {t('schedule.rows', {
                    count: entry.rows,
                    rows: formatNumber(entry.rows, { locale }),
                  })}
                </span>
              ) : null}
              {entry.error ? <span className="ks-help error">{entry.error}</span> : null}
            </li>
          ))}
        </ul>
      ),
    },
  ];
  if (detail.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(detail.error, t)}
      </p>
    );
  }
  return (
    <DataTable
      caption={t('schedule.runs')}
      columns={columns}
      rows={detail.data?.runs ?? []}
      rowKey={(run) => run.id}
      empty={<p className="ks-muted">{t('schedule.no_runs')}</p>}
    />
  );
}

/** One schedule of the person's own: when, to whom, and pause, resume, change or end it. */
function OwnSchedule({ schedule }: { schedule: ReportScheduleResult }) {
  const { t, locale } = useLanguage();
  const changes = useScheduleChanges();
  const when = useWhen();
  const [editing, setEditing] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [ending, setEnding] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const act = (work: Promise<unknown>) => {
    setFailure(undefined);
    work.catch(setFailure);
  };
  if (editing) {
    return (
      <ScheduleForm
        report={schedule.report}
        filters={schedule.filters}
        schedule={schedule}
        onDone={() => setEditing(false)}
      />
    );
  }
  return (
    <li className="ks-card flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-col">
          <strong>
            {t(`report.name_${schedule.report}`)} · {schedule.format.toUpperCase()}
          </strong>
          <span className="ks-meta">
            {when(schedule)} ·{' '}
            {t('schedule.to', {
              count: schedule.recipients.length,
              names: schedule.recipients.map((person) => person.name).join(', '),
            })}
          </span>
        </span>
        {schedule.status === 'active' ? (
          <StatusBadge variant="success">
            {schedule.nextSend
              ? t('schedule.next', { date: formatDate(schedule.nextSend, { locale }) })
              : t('schedule.active')}
          </StatusBadge>
        ) : (
          <StatusBadge variant={schedule.pausedReason === 'owner_access' ? 'danger' : 'neutral'}>
            {t(`schedule.paused_${schedule.pausedReason ?? 'by_owner'}`)}
          </StatusBadge>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          {t('schedule.change')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            act(
              changes.update(schedule.id, {
                status: schedule.status === 'active' ? 'paused' : 'active',
              }),
            )
          }
        >
          {t(schedule.status === 'active' ? 'schedule.pause' : 'schedule.resume')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowRuns((open) => !open)}>
          {t(showRuns ? 'schedule.hide_runs' : 'schedule.show_runs')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEnding(true)}>
          {t('schedule.end')}
        </Button>
      </div>
      {ending ? (
        <Confirm
          question={t('schedule.end_question')}
          action={
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setEnding(false);
                act(changes.end(schedule.id));
              }}
            >
              {t('schedule.end')}
            </Button>
          }
          cancel={
            <Button size="sm" variant="ghost" onClick={() => setEnding(false)}>
              {t('common.cancel')}
            </Button>
          }
        />
      ) : null}
      {failure !== undefined ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {showRuns ? <Runs id={schedule.id} /> : null}
    </li>
  );
}

/**
 * Scheduled reports (decision D122): the person's own schedules, if they may schedule, and those
 * sent to them, each of which they may stop receiving.
 */
export function SchedulesPanel({ canSchedule }: { canSchedule: boolean }) {
  const { t } = useLanguage();
  const when = useWhen();
  const own = useSchedules('owner', canSchedule);
  const received = useSchedules('me', true);
  const changes = useScheduleChanges();
  const [leaving, setLeaving] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>();
  return (
    <div className="flex flex-col gap-6">
      {canSchedule ? (
        <section className="flex flex-col gap-3" aria-label={t('schedule.yours')}>
          <h2 className="heading-md">{t('schedule.yours')}</h2>
          {own.isError ? (
            <p className="ks-help error" role="alert">
              {errorMessage(own.error, t)}
            </p>
          ) : (own.data ?? []).length === 0 ? (
            <EmptyState icon={<Icon icon={CalendarClock} />} title={t('schedule.none_title')}>
              {t('schedule.none_body')}
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {own.data!.map((schedule) => (
                <OwnSchedule key={schedule.id} schedule={schedule} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <section className="flex flex-col gap-3" aria-label={t('schedule.sent_to_you')}>
        <h2 className="heading-md">{t('schedule.sent_to_you')}</h2>
        {received.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(received.error, t)}
          </p>
        ) : (received.data ?? []).length === 0 ? (
          <p className="ks-muted">{t('schedule.none_received')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {received.data!.map((schedule) => (
              <li key={schedule.id} className="ks-card flex flex-col gap-2">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-col">
                    <strong>{t(`report.name_${schedule.report}`)}</strong>
                    <span className="ks-meta">
                      {when(schedule)} · {t('schedule.from', { name: schedule.owner.name })}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Icon icon={Mail} />}
                    onClick={() => setLeaving(schedule.id)}
                  >
                    {t('schedule.stop_sending')}
                  </Button>
                </span>
                {leaving === schedule.id ? (
                  <Confirm
                    question={t('schedule.leave_question')}
                    action={
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          setLeaving(null);
                          setFailure(undefined);
                          changes.leave(schedule.id).catch(setFailure);
                        }}
                      >
                        {t('schedule.stop_sending')}
                      </Button>
                    }
                    cancel={
                      <Button size="sm" variant="ghost" onClick={() => setLeaving(null)}>
                        {t('common.cancel')}
                      </Button>
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {failure !== undefined ? (
          <p className="ks-help error" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
      </section>
      <Notice>{t('schedule.email_note')}</Notice>
    </div>
  );
}
