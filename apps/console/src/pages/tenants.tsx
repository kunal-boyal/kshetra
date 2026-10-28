import { Link } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatNumber } from '@thelamp/i18n';
import { type ConsoleTenant, TENANT_STATUSES } from '@thelamp/shared';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  SelectField,
  StatTile,
  TextField,
} from '@thelamp/ui-web';
import { Building2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConsole } from '../context';
import { useTemplates, useTenants, useTenantSummary } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { holds, TenantStatusBadge, VIEWER_TIME_ZONE } from './shared';

type Status = ConsoleTenant['status'];

/** Every tenant, with its status, template, plan, cell, people and trial (module M22). */
export function TenantsPage() {
  const { client } = useConsole();
  const { t, locale } = useLanguage();
  const [status, setStatus] = useState<Status | ''>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const filters = { ...(status ? { status } : {}), ...(q ? { q } : {}) };
  const tenants = useTenants(filters);

  // The search applies a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const rows = tenants.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = useTenantSummary();
  const templates = useTemplates();
  const count = (value: number) => formatNumber(value, { locale });
  const templateName = (key: string) =>
    templates.data?.items.find((template) => template.key === key)?.name[locale] ?? key;
  const figures = summary.data;
  const columns: Column<ConsoleTenant>[] = [
    {
      key: 'name',
      header: t('console.col_tenant'),
      render: (row) => (
        <Link to="/tenants/$tenantId" params={{ tenantId: row.id }} className="font-semibold">
          {row.name}
        </Link>
      ),
    },
    { key: 'slug', header: t('console.col_slug'), render: (row) => <code>{row.slug}</code> },
    {
      key: 'template',
      header: t('console.col_template'),
      render: (row) => templateName(row.template.key),
    },
    {
      key: 'plan',
      header: t('console.col_plan'),
      render: (row) => (row.plan ? row.plan.name[locale] : t('console.no_plan')),
    },
    {
      key: 'seats',
      header: t('console.col_seats'),
      align: 'end',
      render: (row) =>
        row.seatLimit === null
          ? count(row.activeUsers)
          : t('console.seats_of', { used: count(row.activeUsers), limit: count(row.seatLimit) }),
    },
    { key: 'cell', header: t('console.col_cell'), render: (row) => <code>{row.cell.name}</code> },
    {
      key: 'last',
      header: t('console.col_last_activity'),
      render: (row) =>
        row.lastActivityAt
          ? formatDateTime(row.lastActivityAt, { locale, timeZone: VIEWER_TIME_ZONE })
          : t('console.never'),
    },
    {
      key: 'trial',
      header: t('console.col_trial_ends'),
      render: (row) =>
        row.trialEndsAt ? formatDate(row.trialEndsAt.slice(0, 10), { locale }) : '—',
    },
    {
      key: 'status',
      header: t('console.col_status'),
      render: (row) => <TenantStatusBadge status={row.status} />,
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="heading-xl">{t('console.tenants')}</h1>
          <p className="ks-meta">{t('console.tenants_meta')}</p>
        </div>
        {holds(client.staff, 'platform.tenant.manage') ? (
          <Link to="/tenants/new" className="ks-btn primary sm">
            <Plus size={16} aria-hidden="true" />
            {t('console.new_tenant')}
          </Link>
        ) : null}
      </div>
      {figures ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] gap-4">
          <StatTile
            label={t('console.tile_paying')}
            value={count(figures.paying)}
            sub={t('console.tile_paying_sub', {
              trial: count(figures.trial),
              demo: count(figures.demo),
            })}
          />
          <StatTile
            label={t('console.tile_seats')}
            value={count(figures.seatsInUse)}
            sub={t('console.tile_seats_sub', { bought: count(figures.seatsBought) })}
            {...(figures.seatsBought > 0
              ? { meter: figures.seatsInUse / figures.seatsBought }
              : {})}
          />
          <StatTile
            label={t('console.tile_active')}
            value={count(figures.activeToday)}
            sub={
              figures.seatsInUse > 0
                ? t('console.tile_active_sub', {
                    share: formatNumber(
                      figures.activeToday / figures.seatsInUse,
                      { locale },
                      { style: 'percent', maximumFractionDigits: 0 },
                    ),
                  })
                : undefined
            }
          />
          <StatTile
            label={t('console.tile_suspended')}
            value={count(figures.suspended)}
            {...(figures.suspended > 0 ? { tone: 'danger' as const } : {})}
            sub={t('console.tile_tenants', { count: count(figures.tenants) })}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-4">
        <TextField
          label={t('console.search')}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SelectField
          label={t('console.col_status')}
          none={t('console.any_status')}
          value={status}
          onChange={(event) => setStatus(event.target.value as Status | '')}
          options={TENANT_STATUSES.map((value) => ({
            value,
            label: t(`console.status_${value}`),
          }))}
        />
      </div>
      {tenants.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(tenants.error, t)}
        </p>
      ) : tenants.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('console.tenants')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              icon={<Building2 aria-hidden="true" />}
              title={t('console.no_tenants_title')}
            >
              {t('console.no_tenants')}
            </EmptyState>
          }
          {...(tenants.hasNextPage
            ? {
                more: {
                  label: t('console.load_more'),
                  busy: tenants.isFetchingNextPage,
                  onClick: () => void tenants.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
      {tenants.isError ? (
        <Button variant="secondary" onClick={() => void tenants.refetch()}>
          {t('common.retry')}
        </Button>
      ) : null}
    </>
  );
}
