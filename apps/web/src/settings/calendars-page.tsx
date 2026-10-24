import { type CalendarResult, CalendarListResult, type Holiday, todayIn } from '@thelamp/shared';
import {
  Button,
  Checkbox,
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
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, write } from '../people/data';
import { fieldErrors, PageHeader, useDates } from '../people/shared';
import { useCalendars } from './data';

/**
 * Holiday calendars (M13, spec 5.10, decision D80): each calendar's weekly offs, and its holidays
 * of a year to add or take off one by one. Imports load a whole year from a file.
 */
export function CalendarsPage() {
  const { t } = useLanguage();
  const access = useAccess();
  const thisYear = Number(todayIn(access.timezone).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const calendars = useCalendars(year);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('calendars.title')} intro={t('calendars.intro')} />
      <p className="ks-muted">{t('calendars.import_hint')}</p>
      <div className="max-w-48">
        <SelectField
          label={t('calendars.year')}
          value={String(year)}
          options={[thisYear - 1, thisYear, thisYear + 1].map((value) => ({
            value: String(value),
            label: String(value),
          }))}
          onChange={(event) => setYear(Number(event.target.value))}
        />
      </div>
      {calendars.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(calendars.error, t)}
        </p>
      ) : calendars.data ? (
        calendars.data.items.map((calendar) => (
          <CalendarCard key={calendar.key} calendar={calendar} year={calendars.data.year} />
        ))
      ) : (
        <p className="ks-muted">{t('common.loading')}</p>
      )}
    </div>
  );
}

function CalendarCard({ calendar, year }: { calendar: CalendarResult; year: number }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<Holiday>();
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  async function put(date: string, body: { name: string; optional: boolean; active: boolean }) {
    const result = await write(
      client,
      'PUT',
      `/v1/calendars/${calendar.key}/holidays/${date}`,
      CalendarListResult,
      body,
    );
    if (result) queryClient.setQueryData(['calendars', result.year], result);
    await queryClient.invalidateQueries({ queryKey: ['attendance'] });
  }

  async function remove(holiday: Holiday) {
    setBusy(true);
    setFailure(undefined);
    try {
      await put(holiday.date, { name: holiday.name, optional: holiday.optional, active: false });
      setRemoving(undefined);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const offs = [...calendar.weeklyOffs]
    .sort()
    .map((day) => t(`plan.weekday_${day as 1 | 2 | 3 | 4 | 5 | 6 | 7}`))
    .join(', ');
  const columns: Column<Holiday>[] = [
    { key: 'date', header: t('calendars.date'), render: (holiday) => dates.date(holiday.date) },
    {
      key: 'name',
      header: t('calendars.name'),
      render: (holiday) => (
        <span className="flex flex-wrap items-center gap-2">
          {holiday.name}
          {holiday.optional ? (
            <StatusBadge variant="info">{t('calendars.optional')}</StatusBadge>
          ) : null}
        </span>
      ),
    },
    ...(access.can('calendar.manage')
      ? [
          {
            key: 'actions',
            header: t('calendars.remove'),
            align: 'end' as const,
            render: (holiday: Holiday) => (
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon icon={Trash2} size="sm" />}
                aria-label={`${t('calendars.remove')}: ${holiday.name}`}
                onClick={() => setRemoving(holiday)}
              >
                {t('calendars.remove')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <section className="ks-card flex flex-col gap-4" aria-labelledby={`calendar-${calendar.key}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h2 id={`calendar-${calendar.key}`} className="heading-sm">
          {calendar.name[locale]}
        </h2>
        {calendar.default ? (
          <StatusBadge variant="neutral">{t('calendars.default')}</StatusBadge>
        ) : null}
      </header>
      <p className="ks-muted">
        {offs ? t('calendars.weekly_offs', { days: offs }) : t('calendars.no_weekly_offs')}
      </p>
      {removing ? (
        <Confirm
          question={t('calendars.remove_question', {
            name: removing.name,
            date: dates.date(removing.date),
          })}
          action={
            <Button variant="danger" busy={busy} onClick={() => void remove(removing)}>
              {t('calendars.remove')}
            </Button>
          }
          cancel={
            <Button variant="secondary" onClick={() => setRemoving(undefined)}>
              {t('calendars.keep')}
            </Button>
          }
        />
      ) : null}
      {failure !== undefined ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <DataTable
        caption={t('calendars.holidays', { year: String(year) })}
        columns={columns}
        rows={calendar.holidays}
        rowKey={(holiday) => holiday.date}
        empty={
          <EmptyState icon={<Icon icon={CalendarDays} />} title={t('calendars.none_title')}>
            {t('calendars.none_body')}
          </EmptyState>
        }
      />
      {access.can('calendar.manage') ? <AddHoliday year={year} onAdd={put} /> : null}
    </section>
  );
}

function AddHoliday({
  year,
  onAdd,
}: {
  year: number;
  onAdd: (
    date: string,
    body: { name: string; optional: boolean; active: boolean },
  ) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [optional, setOptional] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    setSaved(false);
    try {
      await onAdd(date, { name: name.trim(), optional, active: true });
      setDate('');
      setName('');
      setOptional(false);
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)} noValidate>
      {saved ? <Notice>{t('common.saved')}</Notice> : null}
      {failure !== undefined && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={t('calendars.date')}
          type="date"
          required
          min={`${year}-01-01`}
          max={`${year}-12-31`}
          value={date}
          {...(errors['date'] ? { error: errors['date'] } : {})}
          onChange={(event) => setDate(event.target.value)}
        />
        <TextField
          label={t('calendars.name')}
          required
          maxLength={80}
          value={name}
          {...(errors['name'] ? { error: errors['name'] } : {})}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <Checkbox
        label={t('calendars.optional')}
        detail={t('calendars.optional_help')}
        checked={optional}
        onChange={(event) => setOptional(event.target.checked)}
      />
      <div>
        <Button
          type="submit"
          busy={busy}
          disabled={!date || !name.trim()}
          icon={<Icon icon={Plus} />}
        >
          {t('calendars.add')}
        </Button>
      </div>
    </form>
  );
}
