import { formatNumber } from '@thelamp/i18n';
import { maskPhone, SignedOutEveryoneResult, type UserView } from '@thelamp/shared';
import {
  Avatar,
  Button,
  type Column,
  Confirm,
  DataTable,
  EmptyState,
  FilterChips,
  Icon,
  PageHeader,
  SelectField,
  TextField,
} from '@thelamp/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { LogOut, Search, Upload, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { type UserFilters, useAccess, useTerritories, useUsers, write } from './data';
import { designationName, UserStatusBadge, useDates, useSettled } from './shared';

/**
 * People (spec 8.2, decision D104): everyone the viewer's scope reaches, with their designation,
 * manager, territory, masked mobile, phone and last sync, found by name, code or number, with
 * status chips and their counts, and the plan's seats in the heading.
 */
export function PeoplePage() {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<UserFilters['status'] | ''>('active');
  const [designation, setDesignation] = useState('');
  const [territoryId, setTerritoryId] = useState('');
  const territories = useTerritories();
  // The search waits for typing to pause, so each key doesn't ask the server.
  const settled = useSettled(q.trim());
  const filters: UserFilters = {
    ...(settled ? { q: settled } : {}),
    ...(status ? { status } : {}),
    ...(designation ? { designation } : {}),
    ...(territoryId ? { territoryId } : {}),
  };
  const users = useUsers(filters);
  const summary = users.data?.pages[0]?.summary ?? null;
  const n = (value: number) => formatNumber(value, { locale });
  const { client } = useApp();
  // Signing everyone else out (decision D101), for whoever may end anyone's sessions and reaches
  // the whole organisation.
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string }>();
  async function signOutEveryone() {
    setBusy(true);
    try {
      const result = await write(
        client,
        'POST',
        '/v1/users/sign-out-everyone',
        SignedOutEveryoneResult,
      );
      setNotice({
        ok: true,
        text: t('people.signed_out_everyone', { count: result?.people ?? 0 }),
      });
      setAsking(false);
    } catch (caught) {
      setNotice({ ok: false, text: errorMessage(caught, t) });
    } finally {
      setBusy(false);
    }
  }
  const rows = users.data?.pages.flatMap((page) => page.items) ?? [];

  const columns: Column<UserView>[] = [
    {
      key: 'name',
      header: t('people.name'),
      render: (user) => (
        <Link
          to="/people/$userId"
          params={{ userId: user.id }}
          className="flex items-center gap-2 whitespace-nowrap"
        >
          <Avatar name={user.name} id={user.id} size="sm" />
          <span className="flex flex-col">
            <span className="font-semibold">{user.name}</span>
            <code className="ks-meta">{user.code}</code>
          </span>
        </Link>
      ),
    },
    {
      key: 'designation',
      header: t('people.designation'),
      render: (user) => designationName(user.designation, access.designations, locale),
    },
    {
      key: 'territory',
      header: t('people.territory'),
      render: (user) => user.territories.map((territory) => territory.name).join(', ') || '—',
    },
    {
      key: 'manager',
      header: t('people.reports_to'),
      render: (user) => user.manager?.name ?? '—',
    },
    {
      key: 'mobile',
      header: t('people.mobile'),
      align: 'num',
      render: (user) => (user.phone ? maskPhone(user.phone) : '—'),
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
      <PageHeader
        title={t('people.title')}
        meta={
          summary
            ? [
                t('people.meta_people', {
                  count: summary.counts.active + summary.counts.inactive,
                  n: n(summary.counts.active + summary.counts.inactive),
                }),
                t('people.meta_active', { n: n(summary.counts.active) }),
                ...(summary.seats
                  ? [
                      t('people.meta_seats', {
                        used: n(summary.seats.used),
                        limit: n(summary.seats.limit),
                      }),
                    ]
                  : []),
              ].join(' · ')
            : undefined
        }
        actions={
          <>
            {access.can('import.run') ? (
              <Link to="/imports" className="ks-btn secondary sm">
                <Icon icon={Upload} size="sm" />
                {t('people.import')}
              </Link>
            ) : null}
            {access.can('user.sign_out_all') && access.scope === 'tenant' ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Icon icon={LogOut} />}
                onClick={() => {
                  setNotice(undefined);
                  setAsking(true);
                }}
              >
                {t('people.sign_out_everyone')}
              </Button>
            ) : null}
            {access.can('user.manage') ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Icon icon={UserPlus} />}
                onClick={() => void navigate({ to: '/people/new' })}
              >
                {t('people.add')}
              </Button>
            ) : null}
          </>
        }
        toolbar={
          <FilterChips<'active' | 'inactive'>
            label={t('people.status')}
            value={status || null}
            onChange={(next) => setStatus(next ?? '')}
            clearable
            formatCount={n}
            choices={(['active', 'inactive'] as const).map((value) => ({
              value,
              label: t(`people.${value}`),
              ...(summary ? { count: summary.counts[value] } : {}),
            }))}
          />
        }
      />
      {asking ? (
        <Confirm
          question={t('people.sign_out_everyone_confirm')}
          action={
            <Button variant="danger" busy={busy} onClick={() => void signOutEveryone()}>
              {t('people.sign_out_everyone')}
            </Button>
          }
          cancel={<Button onClick={() => setAsking(false)}>{t('common.cancel')}</Button>}
        />
      ) : null}
      {notice ? (
        <p
          className={notice.ok ? undefined : 'ks-help error'}
          role={notice.ok ? 'status' : 'alert'}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr]" role="search">
        <TextField
          label={t('people.search')}
          help={t('people.search_help')}
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
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
        <SelectField
          label={t('people.territory')}
          value={territoryId}
          none={t('common.any')}
          options={(territories.data ?? []).map((territory) => ({
            value: territory.id,
            label: `${territory.name} (${territory.code})`,
          }))}
          onChange={(event) => setTerritoryId(event.target.value)}
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
