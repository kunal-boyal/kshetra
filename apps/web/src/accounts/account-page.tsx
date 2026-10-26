import type { AccountTypeView } from '@thelamp/forms';
import {
  type AccountOverview,
  AccountResult,
  type ContactResult,
  ContactResult as ContactSchema,
  geofenceRadius,
  newId,
} from '@thelamp/shared';
import {
  Button,
  type Column,
  DataTable,
  Icon,
  Notice,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { Inbox, Pencil, Power, UserPlus, UserX } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { customValue } from '../people/custom-fields';
import { SubmissionsSection } from '../submissions/submissions-section';
import { AccountPlanSection } from '../targets/account-plan-section';
import { FinanceSection } from '../finance/finance-section';
import { useAccess, write } from '../people/data';
import { Facts, fieldErrors, PageHeader, Section, useDates } from '../people/shared';
import { useAccountOverview, useAccountTypes, useRefreshAccounts } from './data';
import { AccountStatusBadge, LocationBadge, segmentName, slotName } from './shared';

export function AccountPage({ accountId }: { accountId: string }) {
  const { t } = useLanguage();
  const overview = useAccountOverview(accountId);
  if (overview.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  if (overview.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(overview.error, t)}
      </p>
    );
  }
  return <Account overview={overview.data} />;
}

/**
 * An account's overview (M4): its details, where it is, who works it today and before, its
 * contacts, and the locations proposed for it. Visits, plans, orders and finance join as their
 * modules arrive.
 */
function Account({ overview }: { overview: AccountOverview }) {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const refresh = useRefreshAccounts();
  const dates = useDates(access.timezone);
  const config = useConfig(client, queryClient);
  const { account } = overview;
  const type = useAccountTypes()?.find((entry) => entry.key === account.type);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [message, setMessage] = useState<string>();
  const manages = access.can('account.manage');

  async function switchStatus() {
    setBusy(true);
    setFailure(undefined);
    setMessage(undefined);
    try {
      const next = account.status === 'active' ? 'inactive' : 'active';
      await write(client, 'PATCH', `/v1/accounts/${account.id}`, AccountResult, { status: next });
      setMessage(t(next === 'active' ? 'account.done_on' : 'account.done_off'));
      await refresh(account.id);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const tenantRadius = config.data?.bundle.settings.geofenceRadiusMeters ?? 0;
  const radius = geofenceRadius(
    account.geofenceRadiusM,
    type?.location.geofenceRadiusM,
    tenantRadius,
  );
  const address = [
    account.address.line,
    account.address.city,
    account.address.state,
    account.address.pin,
  ]
    .filter(Boolean)
    .join(', ');
  const details: [string, ReactNode][] = [
    [t('account.code'), <code key="code">{account.code}</code>],
    [t('account.type'), type?.name[locale].one ?? account.type],
    [t('account.territory'), `${account.territory.name} (${account.territory.code})`],
    [
      t('account.parent'),
      account.parent ? (
        <Link to="/accounts/$accountId" params={{ accountId: account.parent.id }}>
          {account.parent.name}
        </Link>
      ) : (
        '—'
      ),
    ],
    [t('account.address'), address || '—'],
    ...((type?.segmentRules.length ?? 0) > 0
      ? [
          [
            t('account.segments'),
            account.segments.map((key) => segmentName(type, key, locale)).join(', ') || '—',
          ] as [string, ReactNode],
        ]
      : []),
    ...(type?.fields ?? [])
      .filter((field) => !['section', 'info_text'].includes(field.type))
      .map((field): [string, ReactNode] => [
        field.label[locale],
        customValue(field, account.custom[field.key], t, locale),
      ]),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={account.name}
        back={{ to: '/accounts', label: type?.name[locale].other ?? t('accounts.title') }}
      >
        {manages ? (
          <>
            <Button
              icon={<Icon icon={Pencil} />}
              onClick={() =>
                void navigate({
                  to: '/accounts/$accountId/edit',
                  params: { accountId: account.id },
                })
              }
            >
              {t('common.edit')}
            </Button>
            {account.status !== 'pending' ? (
              <Button icon={<Icon icon={Power} />} busy={busy} onClick={() => void switchStatus()}>
                {t(account.status === 'active' ? 'account.switch_off' : 'account.switch_on')}
              </Button>
            ) : null}
          </>
        ) : null}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <AccountStatusBadge status={account.status} />
      </div>
      {overview.approvalId ? (
        <Notice icon={<Icon icon={Inbox} />}>
          {t('account.waits')} <Link to="/approvals">{t('account.open_approvals')}</Link>
        </Notice>
      ) : null}
      {account.missingSlots.length > 0 ? (
        <Notice icon={<Icon icon={UserX} />}>
          {t(manages ? 'account.missing_manage' : 'account.missing', {
            slots: account.missingSlots.map((key) => slotName(type, key, locale)).join(', '),
          })}
        </Notice>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {fieldErrors(failure).status ?? errorMessage(failure, t)}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t('account.details')}>
          <Facts items={details} />
        </Section>
        <Section title={t('account.location')}>
          <Facts
            items={[
              [
                t('account.point'),
                account.location
                  ? `${account.location.lat.toFixed(6)}, ${account.location.lng.toFixed(6)}`
                  : t('account.no_location'),
              ],
              [
                t('account.location_status'),
                <LocationBadge key="s" status={account.locationStatus} />,
              ],
              [t('account.geofence'), t('account.metres', { count: radius })],
            ]}
          />
        </Section>
      </div>

      <Assignments overview={overview} type={type} />
      {type?.contacts ? <Contacts overview={overview} manages={manages} /> : null}
      <SubmissionsSection accountId={account.id} />
      <AccountPlanSection accountId={account.id} />
      {access.can('finance.view') ? (
        <FinanceSection accountId={account.id} accountName={`${account.name} (${account.code})`} />
      ) : null}

      {overview.locationProposals.length > 0 ? (
        <Section title={t('account.proposals')}>
          <DataTable
            caption={t('account.proposals')}
            columns={[
              {
                key: 'point',
                header: t('account.point'),
                render: (proposal) =>
                  `${proposal.point.lat.toFixed(6)}, ${proposal.point.lng.toFixed(6)}`,
              },
              {
                key: 'accuracy',
                header: t('account.accuracy'),
                align: 'end',
                render: (proposal) => t('account.metres', { count: Math.round(proposal.accuracy) }),
              },
              {
                key: 'by',
                header: t('account.proposed_by'),
                render: (proposal) => proposal.proposedBy.name,
              },
              {
                key: 'at',
                header: t('account.proposed_at'),
                render: (proposal) => dates.dateTime(proposal.capturedAt),
              },
              {
                key: 'status',
                header: t('account.status'),
                render: (proposal) => (
                  <StatusBadge
                    variant={
                      proposal.status === 'approved'
                        ? 'success'
                        : proposal.status === 'pending'
                          ? 'waiting'
                          : 'neutral'
                    }
                  >
                    {t(`approval.status_${proposal.status}`)}
                  </StatusBadge>
                ),
              },
            ]}
            rows={overview.locationProposals}
            rowKey={(proposal) => proposal.id}
            empty={null}
          />
        </Section>
      ) : null}
    </div>
  );
}

/** Who works the account today, and who did before (spec 5.5). */
function Assignments({ overview, type }: { overview: AccountOverview; type?: AccountTypeView }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const rows = overview.assignments;
  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'slot',
      header: t('account.slot'),
      render: (entry) => slotName(type, entry.slot, locale),
    },
    {
      key: 'user',
      header: t('account.person'),
      render: (entry) =>
        access.can('user.view') ? (
          <Link to="/people/$userId" params={{ userId: entry.user.id }}>
            {entry.user.name}
          </Link>
        ) : (
          entry.user.name
        ),
    },
    { key: 'from', header: t('account.from'), render: (entry) => dates.date(entry.validFrom) },
    {
      key: 'to',
      header: t('account.until'),
      render: (entry) => (entry.validTo ? dates.date(entry.validTo) : t('account.now')),
    },
  ];
  return (
    <Section title={t('account.assignments')}>
      <DataTable
        caption={t('account.assignments')}
        columns={columns}
        rows={rows}
        rowKey={(entry) => `${entry.slot}:${entry.validFrom}`}
        empty={<p className="ks-muted">{t('account.unassigned')}</p>}
      />
    </Section>
  );
}

/** The account's contact people, added and switched off in place. */
function Contacts({ overview, manages }: { overview: AccountOverview; manages: boolean }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const refresh = useRefreshAccounts();
  const { account } = overview;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', role: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = fieldErrors(failure);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await write(client, 'POST', `/v1/accounts/${account.id}/contacts`, ContactSchema, {
        id: newId(),
        name: draft.name.trim(),
        ...(draft.role.trim() ? { role: draft.role.trim() } : {}),
        ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
        ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
      });
      setDraft({ name: '', role: '', phone: '', email: '' });
      setAdding(false);
      await refresh(account.id);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(contact: ContactResult) {
    setFailure(undefined);
    try {
      await write(
        client,
        'PATCH',
        `/v1/accounts/${account.id}/contacts/${contact.id}`,
        ContactSchema,
        { active: !contact.active },
      );
      await refresh(account.id);
    } catch (caught) {
      setFailure(caught);
    }
  }

  const columns: Column<ContactResult>[] = [
    { key: 'name', header: t('contact.name'), render: (contact) => contact.name },
    { key: 'role', header: t('contact.role'), render: (contact) => contact.role ?? '—' },
    { key: 'phone', header: t('contact.phone'), render: (contact) => contact.phone ?? '—' },
    { key: 'email', header: t('contact.email'), render: (contact) => contact.email ?? '—' },
    {
      key: 'status',
      header: t('account.status'),
      render: (contact) => (
        <StatusBadge variant={contact.active ? 'success' : 'neutral'}>
          {t(contact.active ? 'contact.active' : 'contact.inactive')}
        </StatusBadge>
      ),
    },
    ...(manages
      ? [
          {
            key: 'actions',
            header: t('contact.actions'),
            render: (contact: ContactResult) => (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t(contact.active ? 'contact.off_named' : 'contact.on_named', {
                  name: contact.name,
                })}
                onClick={() => void toggle(contact)}
              >
                {t(contact.active ? 'account.switch_off' : 'account.switch_on')}
              </Button>
            ),
          } satisfies Column<ContactResult>,
        ]
      : []),
  ];

  return (
    <Section title={t('account.contacts')}>
      {failure && !adding ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <DataTable
        caption={t('account.contacts')}
        columns={columns}
        rows={overview.contacts}
        rowKey={(contact) => contact.id}
        empty={<p className="ks-muted">{t('contact.none')}</p>}
      />
      {manages && !adding ? (
        <Button
          variant="secondary"
          className="self-start"
          icon={<Icon icon={UserPlus} />}
          onClick={() => setAdding(true)}
        >
          {t('contact.add')}
        </Button>
      ) : null}
      {adding ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void add(event)} noValidate>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label={t('contact.name')}
              required
              value={draft.name}
              {...(errors.name ? { error: errors.name } : {})}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <TextField
              label={t('contact.role')}
              value={draft.role}
              {...(errors.role ? { error: errors.role } : {})}
              onChange={(event) => setDraft({ ...draft, role: event.target.value })}
            />
            <TextField
              label={t('contact.phone')}
              type="tel"
              inputMode="tel"
              value={draft.phone}
              {...(errors.phone ? { error: errors.phone } : {})}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
            <TextField
              label={t('contact.email')}
              type="email"
              value={draft.email}
              {...(errors.email ? { error: errors.email } : {})}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
          </div>
          {failure && !Object.keys(errors).length ? (
            <p className="ks-help error" role="alert">
              {errorMessage(failure, t)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={busy}>
              {t('contact.add')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </Section>
  );
}
