import type { AuditEntry, TransferResult, UserView } from '@thelamp/shared';
import { Button, Confirm, Icon, Notice } from '@thelamp/ui-web';
import { useQueries } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowRightLeft,
  CalendarDays,
  LogOut,
  Pencil,
  RotateCcw,
  Route,
  Smartphone,
  UserCheck,
  UserX,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { UserResult, UserView as UserViewSchema } from '@thelamp/shared';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { customValue } from './custom-fields';
import {
  NOTHING,
  read,
  useAccess,
  useDesignations,
  useHistory,
  useRefreshPeople,
  useRoles,
  useTerritories,
  useTransfers,
  useUser,
  useUserFields,
  write,
} from './data';
import {
  designationName,
  Facts,
  PageHeader,
  Section,
  TransferStatusBadge,
  useDates,
  UserStatusBadge,
} from './shared';
import { SubmissionsSection } from '../submissions/submissions-section';
import { WorkSection } from './work-section';

type Pending = 'reset' | 'sign_out' | 'deactivate' | null;

/**
 * One person (spec 8.2): their profile, phone, transfers and history, and what the viewer may do
 * about them. Resetting the phone, signing out everywhere and deactivating ask first.
 */
export function PersonPage({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const user = useUser(userId);
  if (user.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  if (user.isError) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t('people.title')} back={{ to: '/people', label: t('people.title') }} />
        <p className="ks-help error" role="alert">
          {errorMessage(user.error, t)}
        </p>
      </div>
    );
  }
  return <Person user={user.data} />;
}

function Person({ user }: { user: UserView }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const refresh = useRefreshPeople();
  const dates = useDates(access.timezone);
  const roles = useRoles();
  const fields = useUserFields();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [failure, setFailure] = useState<unknown>();

  async function act(work: () => Promise<unknown>, done?: string) {
    setFailure(undefined);
    setMessage(undefined);
    setBusy(true);
    try {
      await work();
      setPending(null);
      if (done) setMessage(done);
      await refresh(user.id);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const unsent =
    (user.device?.health?.queue.queued ?? 0) + (user.device?.health?.queue.parked ?? 0);
  const role = roles.data?.find((entry) => entry.key === user.role)?.name[locale] ?? user.role;
  const custom = (fields.data?.fields ?? []).map((field): [string, ReactNode] => [
    field.label[locale],
    customValue(field, user.custom[field.key], t, locale),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={user.name} back={{ to: '/people', label: t('people.title') }}>
        {access.can('plan_item.manage') || access.can('route.manage') ? (
          <Button
            icon={<Icon icon={CalendarDays} />}
            onClick={() =>
              void navigate({ to: '/people/$userId/plan', params: { userId: user.id } })
            }
          >
            {t('plan.open')}
          </Button>
        ) : null}
        {access.can('trail.view') ? (
          <Button
            icon={<Icon icon={Route} />}
            onClick={() =>
              void navigate({ to: '/people/$userId/replay', params: { userId: user.id } })
            }
          >
            {t('live.replay')}
          </Button>
        ) : null}
        {access.can('user.manage') ? (
          <>
            <Button
              icon={<Icon icon={Pencil} />}
              onClick={() =>
                void navigate({ to: '/people/$userId/edit', params: { userId: user.id } })
              }
            >
              {t('common.edit')}
            </Button>
            <Button
              icon={<Icon icon={ArrowRightLeft} />}
              onClick={() =>
                void navigate({ to: '/people/$userId/transfer', params: { userId: user.id } })
              }
            >
              {t('person.transfer')}
            </Button>
          </>
        ) : null}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <code>{user.code}</code>
        <UserStatusBadge status={user.status} />
      </div>

      {message ? <Notice>{message}</Notice> : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}

      {pending === 'reset' ? (
        <Confirm
          question={t('person.reset_confirm', { name: user.name })}
          action={
            <Button
              variant="danger"
              busy={busy}
              onClick={() =>
                void act(
                  () => write(client, 'POST', `/v1/users/${user.id}/reset-device`, NOTHING),
                  t('person.done_reset'),
                )
              }
            >
              {t('person.reset_device')}
            </Button>
          }
          cancel={<Button onClick={() => setPending(null)}>{t('common.cancel')}</Button>}
        >
          {unsent > 0 ? <p>{t('person.reset_unsent', { count: unsent })}</p> : null}
        </Confirm>
      ) : null}
      {pending === 'sign_out' ? (
        <Confirm
          question={t('person.sign_out_confirm', { name: user.name })}
          action={
            <Button
              variant="danger"
              busy={busy}
              onClick={() =>
                void act(
                  () => write(client, 'POST', `/v1/users/${user.id}/sign-out-everywhere`, NOTHING),
                  t('person.done_signed_out'),
                )
              }
            >
              {t('person.sign_out_all')}
            </Button>
          }
          cancel={<Button onClick={() => setPending(null)}>{t('common.cancel')}</Button>}
        />
      ) : null}
      {pending === 'deactivate' ? (
        <Confirm
          question={t('person.deactivate_confirm', { name: user.name })}
          action={
            <Button
              variant="danger"
              busy={busy}
              onClick={() =>
                void act(() =>
                  write(client, 'PATCH', `/v1/users/${user.id}`, UserResult, {
                    status: 'inactive',
                  }),
                )
              }
            >
              {t('person.deactivate')}
            </Button>
          }
          cancel={<Button onClick={() => setPending(null)}>{t('common.cancel')}</Button>}
        />
      ) : null}

      <Section title={t('person.profile')}>
        <Facts
          items={[
            [t('person.mobile'), user.phone ?? '—'],
            [t('person.email'), user.email ?? '—'],
            [
              t('person.designation'),
              designationName(user.designation, access.designations, locale),
            ],
            [t('person.role'), role],
            [
              t('person.manager'),
              user.manager ? (
                <Link to="/people/$userId" params={{ userId: user.manager.id }}>
                  {user.manager.name}
                </Link>
              ) : (
                t('people.top')
              ),
            ],
            [
              t('person.territories'),
              user.territories.map((territory) => territory.name).join(', ') ||
                t('person.no_territories'),
            ],
            [t('person.joining_date'), user.joiningDate ? dates.date(user.joiningDate) : '—'],
            [t('person.exit_date'), user.exitDate ? dates.date(user.exitDate) : '—'],
            ...custom,
          ]}
        />
        {access.can('user.manage') ? (
          <div>
            {user.status === 'active' ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon icon={UserX} size="sm" />}
                onClick={() => setPending('deactivate')}
              >
                {t('person.deactivate')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                busy={busy}
                icon={<Icon icon={UserCheck} size="sm" />}
                onClick={() =>
                  void act(() =>
                    write(client, 'PATCH', `/v1/users/${user.id}`, UserResult, {
                      status: 'active',
                    }),
                  )
                }
              >
                {t('person.reactivate')}
              </Button>
            )}
          </div>
        ) : null}
      </Section>

      <Section title={t('person.device')}>
        {user.device ? (
          <Device user={user} timeZone={access.timezone} />
        ) : (
          <p className="ks-muted">{t('person.device_none')}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {access.can('user.reset_device') && user.device ? (
            <Button
              size="sm"
              icon={<Icon icon={RotateCcw} size="sm" />}
              onClick={() => setPending('reset')}
            >
              {t('person.reset_device')}
            </Button>
          ) : null}
          {access.can('user.sign_out_all') ? (
            <Button
              size="sm"
              icon={<Icon icon={LogOut} size="sm" />}
              onClick={() => setPending('sign_out')}
            >
              {t('person.sign_out_all')}
            </Button>
          ) : null}
        </div>
      </Section>

      <WorkSection userId={user.id} calendarKey={user.calendarKey} />
      <SubmissionsSection userId={user.id} />
      <Transfers user={user} />
      <History userId={user.id} />
    </div>
  );
}

/** The bound phone, and what its last heartbeat said (M3). */
function Device({ user, timeZone }: { user: UserView; timeZone: string }) {
  const { t } = useLanguage();
  const dates = useDates(timeZone);
  const device = user.device!;
  const health = device.health;
  return (
    <div className="flex items-start gap-3">
      <Icon icon={Smartphone} />
      <Facts
        items={[
          [t('person.device_model'), device.model ?? device.platform],
          [t('person.app_version'), device.appVersion ?? '—'],
          [t('person.os_version'), device.osVersion ?? '—'],
          [t('person.last_seen'), device.lastSeenAt ? dates.dateTime(device.lastSeenAt) : '—'],
          [
            t('people.last_sync'),
            health?.lastSyncAt ? dates.dateTime(health.lastSyncAt) : t('common.never'),
          ],
          [
            t('person.queue'),
            health
              ? t('person.queue_value', {
                  queued: health.queue.queued,
                  parked: health.queue.parked,
                })
              : '—',
          ],
          [
            t('person.battery'),
            health?.batteryOptimised === undefined
              ? '—'
              : t(health.batteryOptimised ? 'person.battery_on' : 'person.battery_off'),
          ],
          [
            t('person.clock'),
            health?.clockSkewSeconds === null || health?.clockSkewSeconds === undefined
              ? '—'
              : t('person.clock_seconds', { count: health.clockSkewSeconds }),
          ],
        ]}
      />
    </div>
  );
}

/** A transfer's changes in words: the manager, designation, role and territories it moves to. */
function useTransferWords(transfers: readonly TransferResult[]) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const designations = useDesignations();
  const roles = useRoles();
  const territories = useTerritories();
  const managerIds = [
    ...new Set(
      transfers.flatMap((transfer) =>
        transfer.changes.managerId ? [transfer.changes.managerId] : [],
      ),
    ),
  ];
  const managers = useQueries({
    queries: managerIds.map((id) => ({
      queryKey: ['user', id],
      queryFn: () => read(client, `/v1/users/${id}`, UserViewSchema),
    })),
  });
  const managerName = (id: string) =>
    managers[managerIds.indexOf(id)]?.data?.name ?? id.slice(0, 8);
  return (transfer: TransferResult): string[] => {
    const { managerId, designation, role, territoryIds } = transfer.changes;
    return [
      ...(managerId === null ? [t('transfer.to_top')] : []),
      ...(managerId ? [t('transfer.to_manager', { name: managerName(managerId) })] : []),
      ...(designation
        ? [
            t('transfer.to_designation', {
              name:
                designations.data?.find((entry) => entry.key === designation)?.name[locale].one ??
                designation,
            }),
          ]
        : []),
      ...(role
        ? [
            t('transfer.to_role', {
              name: roles.data?.find((entry) => entry.key === role)?.name[locale] ?? role,
            }),
          ]
        : []),
      ...(territoryIds
        ? [
            t('transfer.to_territories', {
              names:
                territoryIds
                  .map(
                    (id) => territories.data?.find((territory) => territory.id === id)?.name ?? id,
                  )
                  .join(', ') || t('common.none'),
            }),
          ]
        : []),
    ];
  };
}

function Transfers({ user }: { user: UserView }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const access = useAccess();
  const refresh = useRefreshPeople();
  const dates = useDates(access.timezone);
  const transfers = useTransfers(user.id);
  const items = transfers.data?.items ?? [];
  const words = useTransferWords(items);
  const [failure, setFailure] = useState<unknown>();

  async function cancel(transfer: TransferResult) {
    setFailure(undefined);
    try {
      await write(client, 'POST', `/v1/users/${user.id}/transfers/${transfer.id}/cancel`, NOTHING);
      await refresh(user.id);
    } catch (caught) {
      setFailure(caught);
    }
  }

  return (
    <Section title={t('person.transfers')}>
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="ks-muted">{t('person.no_transfers')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((transfer) => (
            <li key={transfer.id} className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {t('transfer.on', { date: dates.date(transfer.effectiveDate) })}
                  </span>
                  <TransferStatusBadge status={transfer.status} />
                </div>
                {words(transfer).map((line) => (
                  <span key={line}>{line}</span>
                ))}
                {transfer.reason ? <span className="ks-help error">{transfer.reason}</span> : null}
              </div>
              {transfer.status === 'scheduled' && access.can('user.manage') ? (
                <Button size="sm" variant="ghost" onClick={() => void cancel(transfer)}>
                  {t('transfer.cancel')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const HISTORY_ACTIONS = new Set([
  'user.created',
  'user.updated',
  'user.device_reset',
  'user.signed_out_everywhere',
  'transfer.scheduled',
  'transfer.applied',
  'transfer.cancelled',
  'transfer.failed',
  'session.signed_in',
  'session.device_refused',
]);

function History({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const history = useHistory(userId);
  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];
  const label = (entry: AuditEntry) =>
    HISTORY_ACTIONS.has(entry.action)
      ? t(`history.${entry.action}` as 'history.user.created')
      : t('history.other');
  return (
    <Section title={t('person.history')}>
      {entries.length === 0 ? (
        <p className="ks-muted">{t('person.no_history')}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap gap-2">
              <span className="font-semibold">{label(entry)}</span>
              <span className="ks-muted">{dates.dateTime(entry.createdAt)}</span>
              {entry.actor.kind === 'system' ? (
                <span className="ks-muted">{t('history.by_system')}</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {history.hasNextPage ? (
        <div>
          <Button
            size="sm"
            busy={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {t('common.load_more')}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
