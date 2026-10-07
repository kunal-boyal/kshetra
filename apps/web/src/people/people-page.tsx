import type { UserView } from '@kshetra/shared';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  Icon,
  SelectField,
  TextField,
} from '@kshetra/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { Search, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { type UserFilters, useAccess, useUsers } from './data';
import { designationName, PageHeader, UserStatusBadge, useDates, useSettled } from './shared';

/**
 * People (spec 8.2): everyone the viewer's scope reaches, with their designation, manager,
 * territory, phone and last sync, found by name, code or number.
 */
export function PeoplePage() {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<UserFilters['status'] | ''>('active');
  const [designation, setDesignation] = useState('');
  // The search waits for typing to pause, so each key doesn't ask the server.
  const settled = useSettled(q.trim());
  const filters: UserFilters = {
    ...(settled ? { q: settled } : {}),
    ...(status ? { status } : {}),
    ...(designation ? { designation } : {}),
  };
  const users = useUsers(filters);
  const rows = users.data?.pages.flatMap((page) => page.items) ?? [];

  const columns: Column<UserView>[] = [
    {
      key: 'name',
      header: t('people.name'),
      render: (user) => (
        <Link to="/people/$userId" params={{ userId: user.id }} className="flex flex-col">
          <span className="font-semibold text-[var(--accent)]">{user.name}</span>
          <code>{user.code}</code>
        </Link>
      ),
    },
    {
      key: 'designation',
      header: t('people.designation'),
      render: (user) => designationName(user.designation, access.designations, locale),
    },
    {
      key: 'manager',
      header: t('people.reports_to'),
      render: (user) => user.manager?.name ?? '—',
    },
    {
      key: 'territory',
      header: t('people.territory'),
      render: (user) => user.territories.map((territory) => territory.name).join(', ') || '—',
    },
    {
      key: 'phone',
      header: t('people.phone'),
      render: (user) =>
        user.device ? (
          (user.device.model ?? user.device.platform)
        ) : (
          <span className="ks-muted">{t('people.not_bound')}</span>
        ),
    },
    {
      key: 'sync',
      header: t('people.last_sync'),
      render: (user) => {
        const at = user.device?.health?.lastSyncAt ?? null;
        return at ? dates.dateTime(at) : <span className="ks-muted">{t('common.never')}</span>;
      },
    },
    {
      key: 'status',
      header: t('people.status'),
      render: (user) => <UserStatusBadge status={user.status} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('people.title')}>
        {access.can('user.manage') ? (
          <Button
            variant="primary"
            icon={<Icon icon={UserPlus} />}
            onClick={() => void navigate({ to: '/people/new' })}
          >
            {t('people.add')}
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr]" role="search">
        <TextField
          label={t('people.search')}
          help={t('people.search_help')}
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <SelectField
          label={t('people.status')}
          value={status}
          none={t('common.any')}
          options={[
            { value: 'active', label: t('people.active') },
            { value: 'inactive', label: t('people.inactive') },
          ]}
          onChange={(event) => setStatus(event.target.value as UserFilters['status'] | '')}
        />
        <SelectField
          label={t('people.designation')}
          value={designation}
          none={t('common.any')}
          options={access.designations.map((entry) => ({
            value: entry.key,
            label: entry.name[locale].one,
          }))}
          onChange={(event) => setDesignation(event.target.value)}
        />
      </div>

      {users.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(users.error, t)}
        </p>
      ) : users.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('people.caption')}
          columns={columns}
          rows={rows}
          rowKey={(user) => user.id}
          empty={
            <EmptyState icon={<Icon icon={q ? Search : Users} />} title={t('people.empty_title')}>
              {t('people.empty_body')}
            </EmptyState>
          }
          {...(users.hasNextPage
            ? {
                more: {
                  label: t('common.load_more'),
                  busy: users.isFetchingNextPage,
                  onClick: () => void users.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
    </div>
  );
}
