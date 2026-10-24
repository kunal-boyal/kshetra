import { Link } from '@tanstack/react-router';
import { formatDate } from '@thelamp/i18n';
import { type ConsoleTenant, TENANT_STATUSES } from '@thelamp/shared';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  SelectField,
  TextField,
} from '@thelamp/ui-web';
import { Building2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConsole } from '../context';
import { useTenants } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { holds, TenantStatusBadge } from './shared';

type Status = ConsoleTenant['status'];

/** Every tenant, with its status, template, cell, people and trial (module M22). */
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
    { key: 'slug', header: t('console.col_slug'), render: (row) => row.slug },
    {
      key: 'status',
      header: t('console.col_status'),
      render: (row) => <TenantStatusBadge status={row.status} />,
    },
    {
      key: 'template',
      header: t('console.col_template'),
      render: (row) => row.template.key,
    },
    { key: 'cell', header: t('console.col_cell'), render: (row) => row.cell.name },
    {
      key: 'users',
      header: t('console.col_users'),
      align: 'end',
      render: (row) => row.activeUsers,
    },
    {
      key: 'trial',
      header: t('console.col_trial_ends'),
      render: (row) =>
        row.trialEndsAt ? formatDate(row.trialEndsAt.slice(0, 10), { locale }) : '—',
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="heading-xl">{t('console.tenants')}</h1>
        {holds(client.staff, 'platform.tenant.manage') ? (
          <Link to="/tenants/new" className="ks-btn primary">
            <Plus size={16} aria-hidden="true" />
            {t('console.new_tenant')}
          </Link>
        ) : null}
      </div>
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
