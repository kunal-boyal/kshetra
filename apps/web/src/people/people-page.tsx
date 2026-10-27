import { SignedOutEveryoneResult, type UserView } from '@thelamp/shared';
import {
  Button,
  type Column,
  Confirm,
  DataTable,
  EmptyState,
  Icon,
  SelectField,
  TextField,
} from '@thelamp/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { LogOut, Search, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { type UserFilters, useAccess, useUsers, write } from './data';
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
        {access.can('user.sign_out_all') && access.scope === 'tenant' ? (
          <Button
            variant="secondary"
            icon={<Icon icon={LogOut} />}
            onClick={() => {
              setNotice(undefined);
              setAsking(true);
            }}
          >
            {t('people.sign_out_everyone')}
          </Button>
        ) : null}
      </PageHeader>
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
