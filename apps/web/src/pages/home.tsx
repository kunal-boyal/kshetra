import { formatMonth, formatNumber, localeTag } from '@thelamp/i18n';
import { type DashboardResult, timeIn, todayIn } from '@thelamp/shared';
import {
  Avatar,
  type BadgeVariant,
  EmptyState,
  type Hue,
  Icon,
  IconChip,
  List,
  ListItem,
  PageHeader,
  PeriodStepper,
  Section,
  SelectField,
  StatTile,
  StatusBadge,
} from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import {
  CalendarDays,
  ClipboardCheck,
  Clock,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  MapPin,
  ReceiptText,
} from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { ChartOption } from '../charts/chart';
import { useApp } from '../context';
import { useDashboard } from '../dashboard/data';
import { useMe } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { MetricTile, RankCell, useFigure } from '../performance/shared';
import { rowLink } from '../row-link';

/** ECharts loads in its own chunk, so only pages with charts fetch it (decision D63). */
const Chart = lazy(() => import('../charts/chart').then((module) => ({ default: module.Chart })));

/** Pending work is hatched as well as coloured, as amber and green are close for some readers. */
const hatch = (colour: string) => ({
  color: colour,
  dashArrayX: [1, 0],
  dashArrayY: [3, 3],
  rotation: Math.PI / 4,
});

/** Bars end in a small radius on their far side (marks: 4 px data ends). */
const END = 4;

/** One metric day by day: approved, and pending stacked above it, hatched. */
function Trend({ data }: { data: DashboardResult }) {
  const { t, locale } = useLanguage();
  const figure = useFigure();
  const lines = data.trend.filter((line) => line.days.length > 0);
  const [chosen, setChosen] = useState<string>();
  const line = lines.find((entry) => entry.key === chosen) ?? lines[0];
  const metric = data.tiles.find((tile) => tile.metric.key === line?.key)?.metric;
  const name = metric?.name[locale].other ?? '';
  const option = (token: (name: string) => string): ChartOption => {
    const days = line?.days ?? [];
    const ink = token('--text-muted');
    return {
      grid: { left: 8, right: 8, top: 12, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (value: unknown) =>
          metric ? figure(metric, value === null ? null : String(value)) : String(value),
      },
      xAxis: {
        type: 'category',
        data: days.map((day) => Number(day.date.slice(8, 10))),
        axisLine: { lineStyle: { color: token('--chart-grid') } },
        axisTick: { show: false },
        axisLabel: { color: ink },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: token('--chart-grid') } },
        axisLabel: { color: ink },
      },
      series: [
        {
          name: t('home.approved'),
          type: 'bar',
          stack: 'day',
          barMaxWidth: 16,
          itemStyle: {
            color: token('--success-solid'),
            borderColor: token('--surface'),
            borderWidth: 1,
          },
          data: days.map((day) => day.actual),
        },
        {
          name: t('home.pending'),
          type: 'bar',
          stack: 'day',
          barMaxWidth: 16,
          itemStyle: {
            color: token('--surface'),
            borderColor: token('--pending-solid'),
            borderWidth: 1.5,
            borderRadius: [END, END, 0, 0],
            decal: hatch(token('--pending-solid')),
          },
          data: days.map((day) => day.pending),
        },
      ],
    };
  };
  const choice =
    lines.length > 1 && line ? (
      <SelectField
        label={t('home.trend_metric')}
        className="max-w-[14rem]"
        value={line.key}
        options={lines.map((entry) => ({
          value: entry.key,
          label:
            data.tiles.find((tile) => tile.metric.key === entry.key)?.metric.name[locale].other ??
            entry.key,
        }))}
        onChange={(event) => setChosen(event.target.value)}
      />
    ) : null;
  return (
    <section
      className="ks-card flex min-w-0 flex-col gap-4"
      aria-label={metric ? t('home.trend_by_day', { metric: name }) : t('home.trend')}
    >
      <div className="ks-spread flex-wrap gap-3">
        <h2 className="heading-md">
          {metric ? t('home.trend_by_day', { metric: name }) : t('home.trend')}
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <Legend />
          {choice}
        </div>
      </div>
      {!line || !metric ? (
        <p className="ks-muted">{t('performance.trend_empty')}</p>
      ) : (
        <Chart
          label={t('home.trend_label', { metric: name })}
          option={option}
          tableLabel={t('home.show_numbers')}
          table={
            <table className="ks-table">
              <caption className="sr-only">{t('home.trend_label', { metric: name })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('performance.date')}</th>
                  <th scope="col" className="r">
                    {t('home.approved')}
                  </th>
                  <th scope="col" className="r">
                    {t('home.pending')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {line.days.map((day) => (
                  <tr key={day.date}>
                    <th scope="row">{day.date}</th>
                    <td className="r">
                      {figure(metric, day.actual === null ? null : String(day.actual))}
                    </td>
                    <td className="r">
                      {figure(metric, day.pending === null ? null : String(day.pending))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      )}
    </section>
  );
}

/** The trend's key, drawn as the bars are: approved solid, waiting hatched. */
function Legend() {
  const { t } = useLanguage();
  const swatch = 'inline-block h-2.5 w-2.5 rounded-[var(--radius-xs)]';
  return (
    <div className="flex items-center gap-3 text-sm" aria-hidden="true">
      <span className="flex items-center gap-1.5">
        <span className={swatch} style={{ background: 'var(--success-solid)' }} />
        {t('home.approved')}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={swatch}
          style={{
            background:
              'repeating-linear-gradient(45deg, var(--pending-solid) 0 3px, var(--pending-bg) 3px 6px)',
          }}
        />
        {t('home.pending')}
      </span>
    </div>
  );
}

/** The month's forms, each a bar of approved, pending (hatched) and rejected. */
function Mix({ data }: { data: DashboardResult }) {
  const { t, locale } = useLanguage();
  const rows = data.mix;
  const option = (token: (name: string) => string): ChartOption => {
    const ink = token('--text-muted');
    const names = rows.map((row) => row.form.name[locale].other);
    const segment = (name: string, values: number[], style: Record<string, unknown>) => ({
      name,
      type: 'bar',
      stack: 'form',
      barMaxWidth: 20,
      itemStyle: style,
      data: values,
    });
    return {
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: ink }, itemWidth: 12, itemHeight: 12 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: token('--chart-grid') } },
        axisLabel: { color: ink },
      },
      yAxis: {
        type: 'category',
        data: names,
        inverse: true,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: token('--chart-grid') } },
        axisLabel: { color: token('--text') },
      },
      series: [
        segment(
          t('home.approved'),
          rows.map((row) => row.approved),
          { color: token('--success-solid'), borderColor: token('--surface'), borderWidth: 1 },
        ),
        segment(
          t('home.pending'),
          rows.map((row) => row.pending),
          {
            color: token('--surface'),
            borderColor: token('--pending-solid'),
            borderWidth: 1.5,
            decal: hatch(token('--pending-solid')),
          },
        ),
        segment(
          t('home.rejected'),
          rows.map((row) => row.rejected),
          {
            color: token('--danger-solid'),
            borderColor: token('--surface'),
            borderWidth: 1,
            borderRadius: [0, END, END, 0],
          },
        ),
      ],
    };
  };
  if (rows.length === 0) return <p className="ks-muted">{t('home.mix_empty')}</p>;
  return (
    <Chart
      label={t('home.mix_label')}
      option={option}
      height={Math.max(160, 48 + rows.length * 36)}
      tableLabel={t('home.show_numbers')}
      table={
        <table className="ks-table">
          <caption className="sr-only">{t('home.mix_label')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('report.col_form')}</th>
              <th scope="col" className="r">
                {t('home.approved')}
              </th>
              <th scope="col" className="r">
                {t('home.pending')}
              </th>
              <th scope="col" className="r">
                {t('home.rejected')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.form.key}>
                <th scope="row">{row.form.name[locale].other}</th>
                <td className="r">{formatNumber(row.approved, { locale })}</td>
                <td className="r">{formatNumber(row.pending, { locale })}</td>
                <td className="r">{formatNumber(row.rejected, { locale })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}

/** The top of the viewer's ranking group, and the viewer, labelled indicative (spec 8.2). */
function Board({ board }: { board: NonNullable<DashboardResult['leaderboard']> }) {
  const { t, locale } = useLanguage();
  const title = t('home.board_title', { group: board.group.name[locale].other });
  return (
    <Section
      title={title}
      className="min-w-0"
      actions={
        <Link to="/performance" search={{ view: 'leaderboard' }} className="label-md">
          {t('home.all')}
        </Link>
      }
    >
      <List label={title} className="flat">
        {board.rows.map((row) => (
          <ListItem
            key={row.user.id}
            lead={<RankCell rank={row.rank} />}
            title={row.you ? `${row.user.name} ${t('leaderboard.you')}` : row.user.name}
            meta={row.territory?.name}
            trailing={
              <span className="metric-md">
                {row.score === null ? '—' : formatNumber(row.score, { locale })}
              </span>
            }
            selected={row.you}
          />
        ))}
      </List>
      <p className="ks-meta">{t('home.indicative')}</p>
    </Section>
  );
}

/** How long ago someone was last seen, as a badge: fresh, a while, or long ago or paused. */
function useSeen() {
  const { t, locale } = useLanguage();
  return (
    person: NonNullable<DashboardResult['onDutyPeople']>[number],
    now: number,
  ): { variant: BadgeVariant; text: string } => {
    if (person.paused) return { variant: 'neutral', text: t('home.paused') };
    if (!person.seenAt) return { variant: 'neutral', text: t('home.seen_never') };
    const minutes = Math.max(0, Math.floor((now - Date.parse(person.seenAt)) / 60_000));
    const variant = minutes < 5 ? 'success' : minutes < 30 ? 'pending' : 'neutral';
    if (minutes < 1) return { variant, text: t('home.seen_now') };
    if (minutes < 60) {
      return {
        variant,
        text: t('home.seen_minutes', { count: minutes, n: formatNumber(minutes, { locale }) }),
      };
    }
    const hours = Math.floor(minutes / 60);
    return {
      variant,
      text: t('home.seen_hours', { count: hours, n: formatNumber(hours, { locale }) }),
    };
  };
}

/**
 * The first people on duty now, with where they are, today's visits and when last seen, counted
 * back from when the dashboard was read.
 */
function OnDuty({ data, readAt }: { data: DashboardResult; readAt: number }) {
  const { t, locale } = useLanguage();
  const seen = useSeen();
  const people = data.onDutyPeople ?? [];
  const title = t('home.duty_title', {
    count: formatNumber(data.onDuty ?? 0, { locale }),
    total: formatNumber(data.people, { locale }),
  });
  return (
    <Section
      title={title}
      className="min-w-0"
      actions={
        <Link to="/live-map" className="label-md">
          {t('nav.live_map')}
        </Link>
      }
    >
      {people.length === 0 ? (
        <p className="ks-muted">{t('home.duty_empty')}</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="ks-table flat">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t('home.col_person')}</th>
                <th scope="col">{t('home.col_where')}</th>
                <th scope="col" className="r">
                  {t('home.col_visits')}
                </th>
                <th scope="col">{t('home.col_seen')}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => {
                const badge = seen(person, readAt);
                return (
                  <tr key={person.user.id}>
                    <th scope="row">
                      <span className="flex items-center gap-2">
                        <Avatar name={person.user.name} id={person.user.id} size="sm" />
                        {person.user.name}
                      </span>
                    </th>
                    <td>{person.place ?? '—'}</td>
                    <td className="r">{formatNumber(person.visits, { locale })}</td>
                    <td>
                      <StatusBadge variant={badge.variant}>{badge.text}</StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** What waits for the viewer, each with its count, linking to where it is done. */
function Waiting({ waiting }: { waiting: DashboardResult['waiting'] }) {
  const { t, locale } = useLanguage();
  const parts = [waiting.plans ?? 0, waiting.leave ?? 0, waiting.expenses ?? 0].reduce(
    (sum, count) => sum + count,
    0,
  );
  const items: {
    key: string;
    count: number | null;
    label: string;
    icon: LucideIcon;
    hue: Hue;
    to: string;
    type?: string;
  }[] = [
    {
      key: 'reviews',
      count: waiting.reviews,
      label: t('home.wait_reviews'),
      icon: ClipboardCheck,
      hue: 'sage',
      to: '/review',
    },
    {
      key: 'plans',
      count: waiting.plans,
      label: t('home.wait_plans'),
      icon: CalendarDays,
      hue: 'sky',
      to: '/approvals',
      type: 'journey_plan',
    },
    {
      key: 'leave',
      count: waiting.leave,
      label: t('home.wait_leave'),
      icon: Clock,
      hue: 'lilac',
      to: '/approvals',
      type: 'leave',
    },
    {
      key: 'expenses',
      count: waiting.expenses,
      label: t('home.wait_expenses'),
      icon: ReceiptText,
      hue: 'peach',
      to: '/approvals',
      type: 'expense',
    },
    {
      key: 'other',
      count: waiting.approvals === null ? null : waiting.approvals - parts,
      label: t('home.wait_other'),
      icon: Inbox,
      hue: 'sand',
      to: '/approvals',
    },
  ];
  const shown = items.filter((item) => item.count !== null && item.count > 0);
  return (
    <Section title={t('home.waiting')} className="min-w-0">
      {shown.length === 0 ? (
        <p className="ks-muted">{t('home.nothing_waiting')}</p>
      ) : (
        <List label={t('home.waiting')} className="flat">
          {shown.map((item) => (
            <ListItem
              key={item.key}
              lead={
                <IconChip size="sm" hue={item.hue}>
                  <Icon icon={item.icon} />
                </IconChip>
              }
              title={item.label}
              trailing={
                <StatusBadge variant="pending">
                  {formatNumber(item.count ?? 0, { locale })}
                </StatusBadge>
              }
              as={rowLink(item.to, item.type ? { type: item.type } : undefined)}
            />
          ))}
        </List>
      )}
    </Section>
  );
}

/** The greeting for the hour on the tenant's clock. */
function greetingKey(timeZone: string) {
  const hour = Number(timeIn(timeZone).slice(0, 2));
  if (hour < 12) return 'home.greeting_morning' as const;
  if (hour < 17) return 'home.greeting_afternoon' as const;
  return 'home.greeting_evening' as const;
}

/**
 * Home (spec 8.2, M18, decisions D63 and D104): the month's metric tiles against target, a metric
 * day by day beside the top of the leaderboard, who is on duty and what waits for the viewer, and
 * the forms filled; their own figures for a field user, their team's for a manager.
 */
export function HomePage() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const me = useMe(client);
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const dashboard = useDashboard(period);
  const data = dashboard.data;

  if (me.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  if (me.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(me.error, t)}
      </p>
    );
  }
  const tag = localeTag(locale);
  const today = new Intl.DateTimeFormat(tag, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${todayIn(access.timezone)}T00:00:00Z`));
  const meta = data
    ? t('home.meta', {
        date: today,
        whose: data.view === 'team' ? t('home.whose_team') : t('home.whose_self'),
        time: new Intl.DateTimeFormat(tag, {
          timeStyle: 'short',
          timeZone: access.timezone,
        }).format(dashboard.dataUpdatedAt),
      })
    : today;
  const team = data?.view === 'team';
  return (
    <div className="ks-stagger flex flex-col gap-6">
      <PageHeader
        title={t(greetingKey(access.timezone), { name: me.data.name.split(' ')[0] ?? '' })}
        meta={meta}
        actions={
          <>
            <PeriodStepper
              value={period}
              onChange={setPeriod}
              format={(value) => formatMonth(value, { locale })}
              label={t('plan.month')}
              previousLabel={t('targets.previous_month')}
              nextLabel={t('targets.next_month')}
            />
            {access.can('report.view') ? (
              <Link to="/reports" className="ks-btn tonal sm">
                {t('nav.reports')}
              </Link>
            ) : null}
          </>
        }
      />
      {dashboard.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(dashboard.error, t)}
        </p>
      ) : !data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          <section
            aria-label={
              team ? t('home.figures_team', { count: data.people }) : t('home.figures_self')
            }
          >
            {data.tiles.length === 0 && !(team && data.onDuty !== null) ? (
              <EmptyState icon={<Icon icon={LayoutDashboard} />} title={t('home.empty_title')}>
                {t('home.empty_body')}
              </EmptyState>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {team && data.onDuty !== null ? (
                  <StatTile
                    label={t('home.on_duty_now')}
                    value={formatNumber(data.onDuty, { locale })}
                    meter={data.people > 0 ? data.onDuty / data.people : 0}
                    sub={
                      <>
                        <span>
                          {t('home.of_people', {
                            count: data.people,
                            n: formatNumber(data.people, { locale }),
                          })}
                        </span>
                        {data.onLeaveToday !== null ? (
                          <span>
                            {t('home.on_leave', {
                              n: formatNumber(data.onLeaveToday, { locale }),
                            })}
                          </span>
                        ) : null}
                      </>
                    }
                    icon={<Icon icon={MapPin} />}
                    hue="mint"
                    as={rowLink('/live-map')}
                  />
                ) : null}
                {data.tiles.map((tile) => (
                  <MetricTile
                    key={tile.metric.key}
                    metric={tile.metric}
                    figures={tile.figures}
                    draft={false}
                    as={rowLink('/performance')}
                  />
                ))}
              </div>
            )}
          </section>
          <div
            className={
              data.leaderboard
                ? 'grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'
                : 'grid gap-4'
            }
          >
            <Suspense fallback={<p className="ks-muted">{t('common.loading')}</p>}>
              <Trend data={data} />
            </Suspense>
            {data.leaderboard ? <Board board={data.leaderboard} /> : null}
          </div>
          {(team && data.onDutyPeople !== null) ||
          data.waiting.reviews !== null ||
          data.waiting.approvals !== null ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
              {team && data.onDutyPeople !== null ? (
                <OnDuty data={data} readAt={dashboard.dataUpdatedAt} />
              ) : null}
              {data.waiting.reviews !== null || data.waiting.approvals !== null ? (
                <Waiting waiting={data.waiting} />
              ) : null}
            </div>
          ) : null}
          <section className="ks-card flex flex-col gap-3" aria-labelledby="home-mix">
            <h2 id="home-mix" className="heading-md">
              {t('home.mix')}
            </h2>
            <Suspense fallback={<p className="ks-muted">{t('common.loading')}</p>}>
              <Mix data={data} />
            </Suspense>
          </section>
        </>
      )}
    </div>
  );
}
