import { formatNumber } from '@kshetra/i18n';
import { type DashboardResult, todayIn } from '@kshetra/shared';
import { EmptyState, Icon, SelectField, StatusBadge, TextField } from '@kshetra/ui-web';
import { Link } from '@tanstack/react-router';
import { ClipboardCheck, Inbox, LayoutDashboard, MapPin } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { ChartOption } from '../charts/chart';
import { useApp } from '../context';
import { useDashboard } from '../dashboard/data';
import { useConfig, useMe } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { MetricTile, useFigure } from '../performance/shared';

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

/** What waits for the viewer, each linking to where it is done. */
function Waiting({ data }: { data: DashboardResult }) {
  const { t } = useLanguage();
  const items = [
    data.waiting.reviews !== null
      ? {
          to: '/review',
          icon: ClipboardCheck,
          text: t('home.reviews', { count: data.waiting.reviews }),
        }
      : null,
    data.waiting.approvals !== null
      ? {
          to: '/approvals',
          icon: Inbox,
          text: t('home.approvals', { count: data.waiting.approvals }),
        }
      : null,
    data.onDuty !== null
      ? { to: '/live-map', icon: MapPin, text: t('home.on_duty', { count: data.onDuty }) }
      : null,
  ].flatMap((item) => (item ? [item] : []));
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-3" aria-label={t('home.waiting')}>
      {items.map((item) => (
        <li key={item.to}>
          <Link to={item.to} className="ks-btn secondary">
            <Icon icon={item.icon} />
            {item.text}
          </Link>
        </li>
      ))}
    </ul>
  );
}

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
      grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: ink }, itemWidth: 12, itemHeight: 12 },
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
  if (!line || !metric) return <p className="ks-muted">{t('performance.trend_empty')}</p>;
  return (
    <div className="flex flex-col gap-3">
      {lines.length > 1 ? (
        <SelectField
          label={t('home.trend_metric')}
          className="max-w-xs"
          value={line.key}
          options={lines.map((entry) => ({
            value: entry.key,
            label:
              data.tiles.find((tile) => tile.metric.key === entry.key)?.metric.name[locale].other ??
              entry.key,
          }))}
          onChange={(event) => setChosen(event.target.value)}
        />
      ) : null}
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
  return (
    <div className="flex flex-col gap-2">
      <p className="ks-muted text-sm">{t('home.indicative')}</p>
      <ol className="flex flex-col gap-1">
        {board.rows.map((row) => (
          <li key={row.user.id} className="flex items-center justify-between gap-3">
            <span className={row.you ? 'font-semibold' : undefined}>
              {row.rank === null ? '—' : `${formatNumber(row.rank, { locale })}.`} {row.user.name}
              {row.you ? ` ${t('leaderboard.you')}` : ''}
            </span>
            <span className="tabular-nums">
              {row.score === null ? '—' : formatNumber(row.score, { locale })}
            </span>
          </li>
        ))}
      </ol>
      <Link to="/leaderboard" className="font-semibold text-[var(--accent)]">
        {t('home.see_leaderboard', { group: board.group.name[locale].other })}
      </Link>
    </div>
  );
}

/**
 * Home (spec 8.2, M18, decision D63): the month's metric tiles against target, a metric day by
 * day, the forms filled, the leaderboard, who is on duty and what waits for the viewer; their own
 * figures for a field user, their team's for a manager.
 */
export function HomePage() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const me = useMe(client);
  const config = useConfig(client, queryClient);
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
  const designation = config.data?.bundle.designations.find(
    (entry) => entry.key === me.data.designation,
  );
  return (
    <div className="ks-stagger flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="display">{t('home.greeting', { name: me.data.name })}</h1>
          {designation && client.session ? (
            <p className="ks-muted">
              {t('home.where', {
                designation: designation.name[locale].one,
                tenant: client.session.tenant.name,
              })}
            </p>
          ) : null}
        </div>
        <TextField
          label={t('plan.month')}
          type="month"
          className="max-w-xs"
          value={period}
          onChange={(event) => {
            if (event.target.value) setPeriod(event.target.value);
          }}
        />
      </header>
      {dashboard.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(dashboard.error, t)}
        </p>
      ) : !data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          <Waiting data={data} />
          <section className="flex flex-col gap-3" aria-labelledby="home-figures">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="home-figures" className="heading-md">
                {data.view === 'team'
                  ? t('home.figures_team', { count: data.people })
                  : t('home.figures_self')}
              </h2>
              {data.view === 'team' ? (
                <StatusBadge variant="info">{t('home.team_view')}</StatusBadge>
              ) : null}
            </div>
            {data.tiles.length === 0 ? (
              <EmptyState icon={<Icon icon={LayoutDashboard} />} title={t('home.empty_title')}>
                {t('home.empty_body')}
              </EmptyState>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {data.tiles.map((tile) => (
                  <MetricTile
                    key={tile.metric.key}
                    metric={tile.metric}
                    figures={tile.figures}
                    draft={false}
                  />
                ))}
              </div>
            )}
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="ks-card flex flex-col gap-3" aria-labelledby="home-trend">
              <h2 id="home-trend" className="heading-md">
                {t('home.trend')}
              </h2>
              <Suspense fallback={<p className="ks-muted">{t('common.loading')}</p>}>
                <Trend data={data} />
              </Suspense>
            </section>
            <section className="ks-card flex flex-col gap-3" aria-labelledby="home-mix">
              <h2 id="home-mix" className="heading-md">
                {t('home.mix')}
              </h2>
              <Suspense fallback={<p className="ks-muted">{t('common.loading')}</p>}>
                <Mix data={data} />
              </Suspense>
            </section>
          </div>
          {data.leaderboard ? (
            <section className="ks-card flex flex-col gap-3" aria-labelledby="home-board">
              <h2 id="home-board" className="heading-md">
                {t('leaderboard.title')}
              </h2>
              <Board board={data.leaderboard} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
