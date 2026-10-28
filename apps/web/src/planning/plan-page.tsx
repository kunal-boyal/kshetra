import { formatMonth, formatWeekday } from '@thelamp/i18n';
import {
  AccountListResult,
  ApprovalResult,
  CalendarListResult,
  GeneratePlanResult,
  LeaveRequestListResult,
  LeaveTypeListResult,
  newId,
  PlanItemListResult,
  type PlanItemResult,
  PlanItemResult as PlanItemSchema,
  type RouteRecurrence,
  RouteListResult,
  type RouteResult,
  RouteResult as RouteSchema,
  SubmitPlanResult,
  todayIn,
} from '@thelamp/shared';
import {
  Avatar,
  Button,
  Checkbox,
  type Column,
  Confirm,
  DataTable,
  EmptyState,
  Icon,
  PeriodStepper,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CalendarPlus,
  Check,
  Plus,
  Route,
  Send,
  X,
} from 'lucide-react';
import { Dot, MapView, Route as RouteLine } from '../maps/map';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { useMe } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, useUser, write } from '../people/data';
import { useDecisions } from '../approvals/data';
import { designationName, fieldErrors, PageHeader, Section, useDates } from '../people/shared';
import { type CalendarCell, MonthCalendar } from './month-calendar';
import { calendarOf, planDays, visitsTitle, workingDays } from './plan-days';
import { PlanTargets } from './plan-targets';

type Translate = ReturnType<typeof useLanguage>['t'];

const STATUS_VARIANT = {
  planned: 'info',
  visited: 'pending',
  completed: 'success',
  missed: 'danger',
  cancelled: 'neutral',
} as const;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** The accounts a person looks after, to plan visits and routes at. */
function usePlaces(userId: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['places', userId],
    queryFn: () => read(client, `/v1/accounts?userId=${userId}&limit=200`, AccountListResult),
  });
}

function usePlan(userId: string, period: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['plan', userId, period],
    queryFn: () =>
      read(client, `/v1/plan-items?userId=${userId}&period=${period}`, PlanItemListResult),
  });
}

function useRoutes(userId: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['routes', userId],
    queryFn: () => read(client, `/v1/routes?userId=${userId}`, RouteListResult),
  });
}

/** A weekday's name, 1 being Monday. */
const weekday = (day: number, t: Translate) =>
  t(`plan.weekday_${day as (typeof WEEKDAYS)[number]}`);

/** A route's recurrence in words. */
function recurrenceText(recurrence: RouteRecurrence, t: Translate): string {
  const days = (list: number[]) => list.map((day) => weekday(day, t)).join(', ');
  switch (recurrence.kind) {
    case 'weekdays':
      return t('plan.every_weekdays', { days: days(recurrence.days) });
    case 'weeks_of_month':
      return t('plan.weeks_of_month', {
        weeks: recurrence.weeks.join(', '),
        days: days(recurrence.days),
      });
    case 'every_n_days':
      return t('plan.every_n_days', { count: recurrence.every, from: recurrence.from });
  }
}

/**
 * A person's journey plan (M8, spec 8.2): their month of planned visits, by date, made from
 * their routes or by hand, cancelled while still planned, and sent for approval where the tenant
 * asks for it; and their routes, the ordered rounds of accounts a month is made from.
 */
export function PlanPage({ userId }: { userId: string }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const user = useUser(userId);
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const plan = usePlan(userId, period);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string>();
  const [failure, setFailure] = useState<unknown>();
  const [cancelling, setCancelling] = useState<PlanItemResult | null>(null);
  const manages = access.can('plan_item.manage');
  const approval = plan.data?.approval ?? null;
  const routes = useRoutes(userId);
  const attendanceOn = !access.modulesOff.includes('leave_attendance');
  const year = period.slice(0, 4);
  const calendars = useQuery({
    queryKey: ['calendars', year],
    queryFn: () => read(client, `/v1/calendars?year=${year}`, CalendarListResult),
    enabled: attendanceOn,
  });
  const leave = useQuery({
    queryKey: ['leave-requests', userId, year],
    queryFn: () =>
      read(client, `/v1/leave-requests?userId=${userId}&year=${year}`, LeaveRequestListResult),
    enabled: attendanceOn,
  });
  const leaveTypes = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => read(client, '/v1/leave-types', LeaveTypeListResult),
    enabled: attendanceOn,
  });
  const calendar = calendarOf(calendars.data?.items, user.data?.calendarKey ?? null);
  const decision = useQuery({
    queryKey: ['approvals', 'one', approval?.approvalId ?? null],
    queryFn: () => read(client, `/v1/approvals/${approval!.approvalId}`, ApprovalResult),
    enabled: approval?.status === 'submitted' && Boolean(approval.approvalId),
  });
  const decisions = useDecisions();
  const me = useMe(client);
  const waiting =
    decision.data?.status === 'pending' &&
    decision.data.steps.some(
      (step) =>
        step.status === 'pending' && step.approvers.some((person) => person.id === me.data?.userId),
    )
      ? decision.data
      : null;
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['plan', userId] });

  async function act(name: string, work: () => Promise<string>) {
    setBusy(name);
    setMessage(undefined);
    setFailure(undefined);
    try {
      setMessage(await work());
      await refresh();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<PlanItemResult>[] = [
    { key: 'date', header: t('plan.date'), render: (item) => dates.date(item.date) },
    {
      key: 'account',
      header: t('plan.account'),
      render: (item) => (
        <Link to="/accounts/$accountId" params={{ accountId: item.account.id }}>
          {item.account.name}
        </Link>
      ),
    },
    {
      key: 'purpose',
      header: t('plan.purpose'),
      render: (item) => item.purpose ?? (item.source === 'route' ? t('plan.from_route') : '—'),
    },
    {
      key: 'status',
      header: t('plan.status'),
      render: (item) => (
        <StatusBadge variant={STATUS_VARIANT[item.status]}>
          {t(`plan.status_${item.status}`)}
        </StatusBadge>
      ),
    },
    ...(manages
      ? [
          {
            key: 'actions',
            header: t('plan.actions'),
            render: (item: PlanItemResult) =>
              item.status === 'planned' ? (
                <Button
                  variant="secondary"
                  icon={<Icon icon={X} />}
                  onClick={() => setCancelling(item)}
                >
                  {t('plan.cancel')}
                </Button>
              ) : null,
          } satisfies Column<PlanItemResult>,
        ]
      : []),
  ];

  const month = formatMonth(period, { locale });
  const items = plan.data?.items ?? [];
  const days = planDays(period, items, calendar, leave.data?.items ?? []);
  const stops = days.reduce((sum, day) => sum + day.items.length, 0);
  const routeNames = new Map((routes.data?.items ?? []).map((route) => [route.id, route.name]));
  const typeName = (key: string) =>
    leaveTypes.data?.items.find((type) => type.key === key)?.name[locale] ?? key;
  const cells: CalendarCell[] = days.map((day) => {
    const visits = day.items.length;
    const stopsText = visits > 0 ? t('plan.day_stops', { count: visits, n: String(visits) }) : null;
    if (day.leave) {
      return {
        date: day.date,
        tone: 'leave',
        title: t(day.leave.state === 'approved' ? 'plan.day_leave' : 'plan.day_leave_asked'),
        detail: [typeName(day.leave.leaveType), stopsText].filter(Boolean).join(' · '),
      };
    }
    if (day.holiday || day.weeklyOff) {
      return {
        date: day.date,
        tone: 'off',
        title: day.holiday ?? t('plan.day_weekly_off'),
        ...(stopsText ? { detail: stopsText } : {}),
      };
    }
    return {
      date: day.date,
      title: visitsTitle(day.items, routeNames),
      ...(stopsText ? { detail: stopsText } : {}),
    };
  });
  const meta = [
    user.data ? designationName(user.data.designation, access.designations, locale) : null,
    user.data?.territories.map((territory) => territory.name).join(', ') || null,
    calendar
      ? t('plan.meta_working', {
          count: workingDays(days),
          n: String(workingDays(days)),
        })
      : null,
    t('plan.meta_stops', { count: stops, n: String(stops) }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={user.data ? t('plan.heading', { name: user.data.name, month }) : t('plan.title')}
        back={{ to: '/people/$userId', params: { userId }, label: user.data?.name ?? '' }}
        {...(user.data
          ? { lead: <Avatar name={user.data.name} id={user.data.id} size="lg" /> }
          : {})}
        meta={meta}
        toolbar={
          <PeriodStepper
            value={period}
            onChange={setPeriod}
            format={(value) => formatMonth(value, { locale })}
            label={t('plan.month')}
            previousLabel={t('targets.previous_month')}
            nextLabel={t('targets.next_month')}
          />
        }
      >
        {approval ? (
          <StatusBadge
            variant={
              approval.status === 'approved'
                ? 'success'
                : approval.status === 'rejected'
                  ? 'danger'
                  : approval.status === 'submitted'
                    ? 'pending'
                    : 'neutral'
            }
          >
            {waiting ? t('plan.waiting_you') : t(`plan.approval_${approval.status}`)}
          </StatusBadge>
        ) : null}
        {manages ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<Icon icon={CalendarPlus} />}
            busy={busy === 'generate'}
            onClick={() =>
              void act('generate', async () => {
                const result = await write(
                  client,
                  'POST',
                  '/v1/plans/generate',
                  GeneratePlanResult,
                  {
                    userId,
                    period,
                  },
                );
                return t('plan.generated', { count: result?.created ?? 0 });
              })
            }
          >
            {t('plan.generate')}
          </Button>
        ) : null}
        {approval && (approval.status === 'draft' || approval.status === 'rejected') ? (
          <Button
            size="sm"
            icon={<Icon icon={Send} />}
            busy={busy === 'submit'}
            onClick={() =>
              void act('submit', async () => {
                await write(client, 'POST', '/v1/plans/submit', SubmitPlanResult, {
                  userId,
                  period,
                });
                return t('plan.submitted');
              })
            }
          >
            {t('plan.submit')}
          </Button>
        ) : null}
        {waiting ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setSendingBack(true)}>
              {t('plan.send_back')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Icon icon={Check} />}
              busy={busy === 'approve'}
              onClick={() =>
                void act('approve', async () => {
                  await decisions.decide(waiting, 'approve');
                  return t('plan.approved');
                })
              }
            >
              {t('plan.approve')}
            </Button>
          </>
        ) : null}
      </PageHeader>
      {waiting && sendingBack ? (
        <div className="ks-card flex flex-col gap-3">
          <TextAreaField
            label={t('plan.send_back_note')}
            required
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              busy={busy === 'reject'}
              disabled={note.trim().length < 3}
              onClick={() =>
                void act('reject', async () => {
                  await decisions.decide(waiting, 'reject', note.trim());
                  setSendingBack(false);
                  setNote('');
                  return t('plan.sent_back');
                })
              }
            >
              {t('plan.send_back')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSendingBack(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {cancelling ? (
        <Confirm
          question={t('plan.cancel_question', {
            name: cancelling.account.name,
            date: dates.date(cancelling.date),
          })}
          action={
            <Button
              variant="danger"
              busy={busy === 'cancel'}
              onClick={() =>
                void act('cancel', async () => {
                  await write(
                    client,
                    'POST',
                    `/v1/plan-items/${cancelling.id}/cancel`,
                    PlanItemSchema,
                  );
                  setCancelling(null);
                  return t('plan.cancelled');
                })
              }
            >
              {t('plan.cancel')}
            </Button>
          }
          cancel={
            <Button variant="secondary" onClick={() => setCancelling(null)}>
              {t('common.cancel')}
            </Button>
          }
        />
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="ks-card min-w-0">
          <MonthCalendar
            period={period}
            caption={t('plan.calendar_caption', { month })}
            weekdays={[1, 2, 3, 4, 5, 6, 7].map((day) => formatWeekday(day, { locale }))}
            cells={cells}
          />
        </div>
        {access.can('target.view') ? <PlanTargets userId={userId} period={period} /> : null}
      </div>

      <Section title={t('plan.visits')}>
        {plan.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(plan.error, t)}
          </p>
        ) : plan.isPending ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : (
          <DataTable
            caption={t('plan.visits_caption')}
            columns={columns}
            rows={plan.data.items}
            rowKey={(item) => item.id}
            empty={
              <EmptyState icon={<Icon icon={CalendarDays} />} title={t('plan.empty_title')}>
                {t('plan.empty_body')}
              </EmptyState>
            }
          />
        )}
      </Section>

      {manages ? <AddVisit userId={userId} onAdded={() => void refresh()} /> : null}
      <Routes userId={userId} />
    </div>
  );
}

/** Plans a visit by hand: where, when, why. */
function AddVisit({ userId, onAdded }: { userId: string; onAdded: () => void }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const access = useAccess();
  const places = usePlaces(userId);
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(() => todayIn(access.timezone));
  const [purpose, setPurpose] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [added, setAdded] = useState(false);
  const errors = fieldErrors(failure);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    setAdded(false);
    try {
      await client.request('POST', '/v1/plan-items', PlanItemSchema, {
        body: {
          id: newId(),
          userId,
          accountId,
          date,
          ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setPurpose('');
      setNote('');
      setAdded(true);
      onAdded();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('plan.add')}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void add(event)}>
        <SelectField
          label={t('plan.account')}
          required
          none={t('plan.choose_account')}
          value={accountId}
          options={(places.data?.items ?? []).map((account) => ({
            value: account.id,
            label: `${account.name} (${account.code})`,
          }))}
          {...(errors.accountId ? { error: errors.accountId } : {})}
          onChange={(event) => setAccountId(event.target.value)}
        />
        <TextField
          label={t('plan.date')}
          type="date"
          required
          value={date}
          {...(errors.date ? { error: errors.date } : {})}
          onChange={(event) => setDate(event.target.value)}
        />
        <TextField
          label={t('plan.purpose')}
          maxLength={200}
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
        />
        <TextAreaField
          label={t('plan.note')}
          help={t('plan.note_help')}
          maxLength={1000}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {failure && !errors.accountId && !errors.date ? (
          <p className="ks-help error sm:col-span-2" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
        {added ? <p role="status">{t('plan.added')}</p> : null}
        <Button
          type="submit"
          variant="primary"
          className="self-start"
          icon={<Icon icon={Plus} />}
          busy={busy}
          disabled={!accountId}
        >
          {t('plan.add')}
        </Button>
      </form>
    </Section>
  );
}

/** The person's routes, and adding or changing one. */
function Routes({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const access = useAccess();
  const routes = useRoutes(userId);
  const [editing, setEditing] = useState<RouteResult | 'new' | null>(null);
  const mayEdit = access.can('route.manage');
  return (
    <Section title={t('plan.routes')}>
      {routes.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(routes.error, t)}
        </p>
      ) : routes.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : routes.data.items.length === 0 ? (
        <p className="ks-muted">{t('plan.no_routes')}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('plan.routes')}>
          {routes.data.items.map((route) => (
            <li key={route.id} className="ks-card flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{route.name}</h3>
                {route.active ? null : (
                  <StatusBadge variant="neutral">{t('plan.route_off')}</StatusBadge>
                )}
              </div>
              <p className="ks-muted">{recurrenceText(route.recurrence, t)}</p>
              <p>{route.accounts.map((account) => account.name).join(' → ')}</p>
              {mayEdit ? (
                <Button
                  variant="secondary"
                  className="self-start"
                  onClick={() => setEditing(route)}
                >
                  {t('common.edit')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {mayEdit && editing === null ? (
        <Button
          className="self-start"
          icon={<Icon icon={Route} />}
          onClick={() => setEditing('new')}
        >
          {t('plan.add_route')}
        </Button>
      ) : null}
      {mayEdit && editing !== null ? (
        <RouteForm
          key={editing === 'new' ? 'new' : editing.id}
          userId={userId}
          route={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
    </Section>
  );
}

/** A route's name, recurrence and ordered accounts. */
/** A route's stops with one moved up (-1) or down (1). */
function moveStop(stops: readonly string[], index: number, by: -1 | 1): string[] {
  const next = [...stops];
  const [moved] = next.splice(index, 1);
  next.splice(index + by, 0, moved!);
  return next;
}

function RouteForm({
  userId,
  route,
  onDone,
}: {
  userId: string;
  route: RouteResult | null;
  onDone: () => void;
}) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const places = usePlaces(userId);
  const [name, setName] = useState(route?.name ?? '');
  const [days, setDays] = useState<number[]>(
    route && route.recurrence.kind !== 'every_n_days' ? route.recurrence.days : [1],
  );
  const [stops, setStops] = useState<string[]>(route?.accounts.map((account) => account.id) ?? []);
  const [active, setActive] = useState(route?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = fieldErrors(failure);
  // The stops with a known place, numbered in route order, for the map (decision D60).
  const located = stops.flatMap((id, index) => {
    const at = places.data?.items.find((account) => account.id === id)?.location;
    return at ? [{ id, at, number: index + 1, name: placeName(id) }] : [];
  });
  function placeName(id: string) {
    return (
      places.data?.items.find((account) => account.id === id)?.name ??
      route?.accounts.find((account) => account.id === id)?.name ??
      id
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    const recurrence = { kind: 'weekdays' as const, days: [...days].sort() };
    try {
      if (route) {
        await write(client, 'PATCH', `/v1/routes/${route.id}`, RouteSchema, {
          name,
          recurrence,
          accountIds: stops,
          active,
        });
      } else {
        await client.request('POST', '/v1/routes', RouteSchema, {
          body: { id: newId(), userId, name, recurrence, accountIds: stops },
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['routes', userId] });
      onDone();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="ks-card flex flex-col gap-3"
      aria-label={route ? t('plan.edit_route') : t('plan.add_route')}
      onSubmit={(event) => void save(event)}
    >
      <TextField
        label={t('plan.route_name')}
        required
        maxLength={100}
        value={name}
        {...(errors.name ? { error: errors.name } : {})}
        onChange={(event) => setName(event.target.value)}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="ks-label">{t('plan.route_days')}</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map((day) => (
            <Checkbox
              key={day}
              label={weekday(day, t)}
              checked={days.includes(day)}
              onChange={(event) =>
                setDays((current) =>
                  event.target.checked
                    ? [...current, day]
                    : current.filter((entry) => entry !== day),
                )
              }
            />
          ))}
        </div>
      </fieldset>
      <SelectField
        label={t('plan.route_add_place')}
        none={t('plan.choose_account')}
        value=""
        options={(places.data?.items ?? [])
          .filter((account) => !stops.includes(account.id))
          .map((account) => ({ value: account.id, label: `${account.name} (${account.code})` }))}
        onChange={(event) =>
          event.target.value && setStops((current) => [...current, event.target.value])
        }
      />
      {stops.length > 0 ? (
        <ol className="flex flex-col gap-1" aria-label={t('plan.route_places')}>
          {stops.map((id, index) => (
            <li key={id} className="flex flex-wrap items-center gap-2">
              <span>
                {index + 1}. {placeName(id)}
              </span>
              <Button
                variant="ghost"
                icon={<Icon icon={ArrowUp} />}
                disabled={index === 0}
                onClick={() => setStops((current) => moveStop(current, index, -1))}
              >
                {t('plan.route_up', { name: placeName(id) })}
              </Button>
              <Button
                variant="ghost"
                icon={<Icon icon={ArrowDown} />}
                disabled={index === stops.length - 1}
                onClick={() => setStops((current) => moveStop(current, index, 1))}
              >
                {t('plan.route_down', { name: placeName(id) })}
              </Button>
              <Button
                variant="ghost"
                icon={<Icon icon={X} />}
                onClick={() => setStops((current) => current.filter((entry) => entry !== id))}
              >
                {t('plan.route_remove', { name: placeName(id) })}
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      {located.length > 0 ? (
        <MapView label={t('plan.route_map')} fit={located.map((stop) => stop.at)} height={300}>
          <RouteLine path={located.map((stop) => stop.at)} />
          {located.map((stop) => (
            <Dot key={stop.id} at={stop.at} label={String(stop.number)} title={stop.name} />
          ))}
        </MapView>
      ) : null}
      {route ? (
        <Checkbox
          label={t('plan.route_active')}
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
      ) : null}
      {failure && !errors.name ? (
        <p className="ks-help error" role="alert">
          {errors.accountIds ?? Object.values(errors)[0] ?? errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!name.trim() || days.length === 0 || stops.length === 0}
        >
          {t('plan.route_save')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
