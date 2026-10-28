import { Link } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatNumber } from '@thelamp/i18n';
import {
  Avatar,
  Button,
  Card,
  Confirm,
  DescriptionList,
  StatTile,
  StatusBadge,
  TextAreaField,
} from '@thelamp/ui-web';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useConsole } from '../context';
import { useConsoleMutations, useTemplates, useTenant, useTenantActivity } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { holds, TenantStatusBadge, VIEWER_TIME_ZONE } from './shared';
import { BillingCard } from './tenant-billing';
import { SecondFactorResetCard } from './tenant-second-factor';
import { TerminationCard } from './tenant-termination';
import { SupportCard } from './support';
import { PlanCard, UsageCard } from './tenant-plan';

/**
 * One tenant: where it lives, what it started from, its trial, its plan, billing and usage,
 * suspending or reopening it, and terminating it.
 */
export function TenantPage({ tenantId }: { tenantId: string }) {
  const { client } = useConsole();
  const { t, locale } = useLanguage();
  const tenant = useTenant(tenantId);
  const activity = useTenantActivity(tenantId);
  const templates = useTemplates();
  const { suspend, reactivate } = useConsoleMutations();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string>();
  const manages = holds(client.staff, 'platform.tenant.manage');

  if (tenant.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(tenant.error, t)}
      </p>
    );
  }
  if (!tenant.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const row = tenant.data;
  const count = (value: number) => formatNumber(value, { locale });
  const facts: [string, string][] = [
    [
      t('console.col_cell'),
      `${row.cell.name} · ${row.cell.region} · ${t(`console.cell_${row.cell.kind}`)}`,
    ],
    [
      t('console.col_trial_ends'),
      row.trialEndsAt ? formatDate(row.trialEndsAt.slice(0, 10), { locale }) : '—',
    ],
    [t('console.created'), formatDateTime(row.createdAt, { locale, timeZone: VIEWER_TIME_ZONE })],
  ];
  const templateName =
    templates.data?.items.find((template) => template.key === row.template.key)?.name[locale] ??
    row.template.key;

  async function act(work: () => Promise<unknown>) {
    setFailure(undefined);
    try {
      await work();
      setAsking(false);
      setReason('');
    } catch (error) {
      setFailure(errorMessage(error, t));
    }
  }

  const tools =
    manages && row.status === 'suspended' ? (
      <Button
        variant="primary"
        size="sm"
        className="self-start"
        busy={reactivate.isPending}
        onClick={() => act(() => reactivate.mutateAsync(row.id))}
      >
        {t('console.reactivate')}
      </Button>
    ) : manages && row.status !== 'terminated' ? (
      asking ? (
        <Confirm
          question={t('console.suspend_question', { name: row.name })}
          action={
            <Button
              variant="danger"
              busy={suspend.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => act(() => suspend.mutateAsync({ id: row.id, reason: reason.trim() }))}
            >
              {t('console.suspend')}
            </Button>
          }
          cancel={
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t('common.cancel')}
            </Button>
          }
        >
          <TextAreaField
            label={t('console.suspend_reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </Confirm>
      ) : (
        <Button variant="danger" size="sm" className="self-start" onClick={() => setAsking(true)}>
          {t('console.suspend')}
        </Button>
      )
    ) : null;

  return (
    <>
      <Link to="/" className="ks-btn ghost sm self-start">
        <ArrowLeft size={16} aria-hidden="true" />
        {t('console.tenants')}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={row.name} id={row.id} size="lg" />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="heading-xl">{row.name}</h1>
            <p className="ks-meta">
              <code>{row.slug}</code>
              {' · '}
              {t('console.tenant_meta', {
                template: templateName,
                version: row.template.version,
                since: formatDate(row.createdAt.slice(0, 10), { locale }),
              })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TenantStatusBadge status={row.status} />
          <StatusBadge variant="neutral">
            {row.plan ? row.plan.name[locale] : t('console.no_plan')}
          </StatusBadge>
          {row.demo ? <StatusBadge variant="info">{t('console.demo')}</StatusBadge> : null}
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] gap-4">
        <StatTile
          label={t('console.col_seats')}
          value={
            row.seatLimit === null
              ? count(row.activeUsers)
              : t('console.seats_of', { used: count(row.activeUsers), limit: count(row.seatLimit) })
          }
          {...(row.seatLimit ? { meter: row.activeUsers / row.seatLimit } : {})}
          {...(row.seatLimit !== null && row.activeUsers > row.seatLimit
            ? { tone: 'danger' as const }
            : {})}
          sub={row.seatLimit === null ? t('console.no_seat_limit') : undefined}
        />
        <StatTile
          label={t('console.tile_active_tenant')}
          value={activity.data ? count(activity.data.activeToday) : '—'}
        />
        <StatTile
          label={t('console.col_last_activity')}
          value={
            row.lastActivityAt
              ? formatDateTime(row.lastActivityAt, { locale, timeZone: VIEWER_TIME_ZONE })
              : t('console.never')
          }
        />
        <StatTile
          label={t('console.tile_storage')}
          value={
            activity.data?.storageBytes ? size(Number(activity.data.storageBytes), locale) : '—'
          }
          sub={t('console.tile_storage_sub')}
        />
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[2_1_26rem] flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <h2 className="heading-md">{t('console.activity_title')}</h2>
            {activity.data ? <ActivityBars days={activity.data.days} /> : null}
            <DescriptionList items={facts} />
          </Card>
          <PlanCard tenant={row} />
          <BillingCard tenant={row} />
          <UsageCard tenantId={row.id} />
        </div>
        <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-4">
          <SupportCard tenant={row} />
          {tools ? (
            <Card className="flex flex-col gap-3">
              <h2 className="heading-md">{t('console.tools')}</h2>
              {tools}
              <p className="ks-meta">{t('console.suspend_note')}</p>
              {failure ? (
                <p className="ks-help error" role="alert">
                  {failure}
                </p>
              ) : null}
            </Card>
          ) : null}
          <SecondFactorResetCard tenant={row} />
          <TerminationCard tenant={row} />
        </div>
      </div>
    </>
  );
}

/** Bytes as people read them: "457.9 MB", "18.4 GB". */
function size(bytes: number, locale: 'en' | 'hi'): string {
  const gb = bytes >= 1024 ** 3;
  return formatNumber(
    bytes / 1024 ** (gb ? 3 : 2),
    { locale },
    { style: 'unit', unit: gb ? 'gigabyte' : 'megabyte', maximumFractionDigits: 1 },
  );
}

/** The last 30 days as bars, each day's people active, with the numbers for screen readers. */
function ActivityBars({ days }: { days: readonly { date: string; active: number }[] }) {
  const { t, locale } = useLanguage();
  const most = Math.max(1, ...days.map((day) => day.active));
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="flex h-30 items-end gap-1" aria-hidden="true">
        {days.map((day) => (
          <span
            key={day.date}
            className="flex-1 rounded-t-[3px] bg-[var(--chart-1)]"
            style={{ height: `${Math.max(3, Math.round((day.active / most) * 100))}%` }}
            title={`${formatDate(day.date, { locale })}: ${day.active}`}
          />
        ))}
      </div>
      <figcaption className="ks-meta">
        {days.every((day) => day.active === 0)
          ? t('console.activity_none')
          : t('console.activity_caption', {
              count: most,
              most: formatNumber(most, { locale }),
              from: formatDate(days[0]!.date, { locale }),
              to: formatDate(days.at(-1)!.date, { locale }),
            })}
      </figcaption>
      <ul className="sr-only">
        {days.map((day) => (
          <li key={day.date}>
            {formatDate(day.date, { locale })}: {formatNumber(day.active, { locale })}
          </li>
        ))}
      </ul>
    </figure>
  );
}
