import { formatDateTime, formatNumber } from '@thelamp/i18n';
import type { CellHealthResult, HealthHour } from '@thelamp/shared';
import { Card, type Column, DataTable, StatusBadge } from '@thelamp/ui-web';
import { useCellHealth, useCells } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { VIEWER_TIME_ZONE } from './shared';

type Translate = ReturnType<typeof useLanguage>['t'];

/** A wait or an age in seconds, as people read it: "45 s", "12 min", "2 h 5 min". */
export function duration(seconds: number | null, t: Translate): string {
  if (seconds === null) return '—';
  if (seconds < 60) return t('console.seconds', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('console.minutes', { count: minutes });
  return t('console.hours_minutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/**
 * Health per cell (module M22, spec 14.6, decision D93): each cell's last minute, what needs
 * looking at against spec 14.6's limits, its queues, and its last day by the hour.
 */
export function HealthPage() {
  const { t } = useLanguage();
  const health = useCellHealth();
  return (
    <>
      <h1 className="heading-xl">{t('console.health')}</h1>
      <p className="ks-muted">{t('console.health_intro')}</p>
      {health.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(health.error, t)}
        </p>
      ) : !health.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : health.data.items.length === 0 ? (
        <p className="ks-muted">{t('console.health_none')}</p>
      ) : (
        <>
          <CellsTable cells={health.data.items} />
          {health.data.items.map((cell) => (
            <CellCard key={cell.cell.name} cell={cell} />
          ))}
        </>
      )}
    </>
  );
}

/** Every cell in a row: its last minute, what waits, when it last reported, and its state. */
function CellsTable({ cells }: { cells: readonly CellHealthResult[] }) {
  const { t, locale } = useLanguage();
  const known = useCells();
  const number = (value: number) => formatNumber(value, { locale });
  const tenantsIn = (name: string) => known.data?.items.find((cell) => cell.name === name)?.tenants;
  const columns: Column<CellHealthResult>[] = [
    {
      key: 'cell',
      header: t('console.col_cell'),
      render: (row) => (
        <span className="flex flex-col">
          <code>{row.cell.name}</code>
          <span className="ks-meta">
            {row.cell.region} · {t(`console.cell_${row.cell.kind}`)}
          </span>
        </span>
      ),
    },
    {
      key: 'tenants',
      header: t('console.tenants'),
      align: 'end',
      render: (row) => {
        const count = tenantsIn(row.cell.name);
        return count === undefined ? '—' : number(count);
      },
    },
    {
      key: 'minute',
      header: t('console.col_last_minute'),
      render: (row) =>
        row.latest
          ? t('console.last_minute_value', {
              requests: number(row.latest.figures.requests),
              errors: number(row.latest.figures.errors),
            })
          : '—',
    },
    {
      key: 'jobs',
      header: t('console.col_jobs_waiting'),
      align: 'end',
      render: (row) =>
        row.latest
          ? number(
              Object.values(row.latest.figures.queues).reduce(
                (sum, queue) => sum + queue.waiting,
                0,
              ),
            )
          : '—',
    },
    {
      key: 'phones',
      header: t('console.health_phones_waiting'),
      align: 'end',
      render: (row) => (row.latest ? number(row.latest.figures.phones.waiting) : '—'),
    },
    {
      key: 'reported',
      header: t('console.col_last_report'),
      render: (row) =>
        row.latest
          ? formatDateTime(row.latest.at, { locale, timeZone: VIEWER_TIME_ZONE })
          : t('console.never'),
    },
    {
      key: 'status',
      header: t('console.col_status'),
      render: (row) =>
        row.issues.length === 0 ? (
          <StatusBadge variant="success">{t('console.health_healthy')}</StatusBadge>
        ) : row.issues.some((issue) => issue.key === 'silent') ? (
          <StatusBadge variant="danger">{t('console.health_silent')}</StatusBadge>
        ) : (
          <StatusBadge variant="waiting">{t('console.health_needs')}</StatusBadge>
        ),
    },
  ];
  return (
    <DataTable
      caption={t('console.health_cells')}
      columns={columns}
      rows={[...cells]}
      rowKey={(row) => row.cell.name}
      empty={null}
    />
  );
}

function CellCard({ cell }: { cell: CellHealthResult }) {
  const { t, locale } = useLanguage();
  const number = (value: number) => formatNumber(value, { locale });
  const latest = cell.latest;
  const figures = latest?.figures;
  const facts: [string, string][] = figures
    ? [
        [t('console.health_requests'), number(figures.requests)],
        [t('console.health_errors'), number(figures.errors)],
        [t('console.health_points'), number(figures.points)],
        [t('console.health_late'), number(figures.latePoints)],
        [t('console.health_outbox'), number(figures.outbox.backlog)],
        [t('console.health_outbox_oldest'), duration(figures.outbox.oldestSeconds, t)],
        [t('console.health_phones'), number(figures.phones.seen)],
        [t('console.health_phones_waiting'), number(figures.phones.waiting)],
        [t('console.health_phones_parked'), number(figures.phones.parked)],
        [t('console.health_phones_oldest'), duration(figures.phones.oldestQueuedSeconds, t)],
      ]
    : [];
  const queues = figures
    ? Object.entries(figures.queues).map(([name, counts]) => ({ name, ...counts }))
    : [];
  const queueColumns: Column<(typeof queues)[number]>[] = [
    { key: 'name', header: t('console.col_queue'), render: (row) => row.name },
    {
      key: 'waiting',
      header: t('console.col_waiting'),
      align: 'end',
      render: (row) => number(row.waiting),
    },
    {
      key: 'active',
      header: t('console.col_running'),
      align: 'end',
      render: (row) => number(row.active),
    },
    {
      key: 'delayed',
      header: t('console.col_later'),
      align: 'end',
      render: (row) => number(row.delayed),
    },
    {
      key: 'failed',
      header: t('console.col_failed'),
      align: 'end',
      render: (row) => number(row.failed),
    },
    {
      key: 'oldest',
      header: t('console.col_oldest_wait'),
      align: 'end',
      render: (row) => duration(row.oldestWaitSeconds, t),
    },
  ];
  const hourColumns: Column<HealthHour>[] = [
    {
      key: 'hour',
      header: t('console.col_hour'),
      render: (row) => formatDateTime(row.hour, { locale, timeZone: VIEWER_TIME_ZONE }),
    },
    {
      key: 'requests',
      header: t('console.col_requests'),
      align: 'end',
      render: (row) => number(row.requests),
    },
    {
      key: 'errors',
      header: t('console.col_errors'),
      align: 'end',
      render: (row) => number(row.errors),
    },
    {
      key: 'points',
      header: t('console.col_points'),
      align: 'end',
      render: (row) => number(row.points),
    },
    {
      key: 'late',
      header: t('console.col_late'),
      align: 'end',
      render: (row) => number(row.latePoints),
    },
    {
      key: 'wait',
      header: t('console.col_worst_wait'),
      align: 'end',
      render: (row) => duration(row.worstQueueWaitSeconds, t),
    },
    {
      key: 'sync',
      header: t('console.col_worst_sync'),
      align: 'end',
      render: (row) => duration(row.worstSyncSeconds, t),
    },
    {
      key: 'minutes',
      header: t('console.col_minutes'),
      align: 'end',
      render: (row) => number(row.minutes),
    },
  ];
  const label = `${cell.cell.name} · ${cell.cell.region} · ${t(`console.cell_${cell.cell.kind}`)}`;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="heading-md">{label}</h2>
        <StatusBadge variant={cell.issues.length === 0 ? 'success' : 'danger'}>
          {t(cell.issues.length === 0 ? 'console.health_ok' : 'console.health_needs')}
        </StatusBadge>
      </div>
      {cell.issues.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {cell.issues.map((issue) => (
            <li key={`${issue.key}-${issue.queue ?? ''}`} className="ks-help error">
              {t(`console.health_issue_${issue.key}`, { queue: issue.queue ?? '' })}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="ks-muted">
        {latest
          ? t('console.health_latest', {
              time: formatDateTime(latest.at, { locale, timeZone: VIEWER_TIME_ZONE }),
            })
          : t('console.health_never')}
      </p>
      {figures ? (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map(([term, value]) => (
              <div key={term} className="flex flex-col gap-1">
                <dt className="ks-muted caption">{term}</dt>
                <dd className="m-0 tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <DataTable
            caption={`${t('console.health_queues')} · ${cell.cell.name}`}
            columns={queueColumns}
            rows={queues}
            rowKey={(row) => row.name}
          />
        </>
      ) : null}
      {cell.hours.length > 0 ? (
        <DataTable
          caption={`${t('console.health_day')} · ${cell.cell.name}`}
          columns={hourColumns}
          rows={cell.hours}
          rowKey={(row) => row.hour}
        />
      ) : null}
    </Card>
  );
}
