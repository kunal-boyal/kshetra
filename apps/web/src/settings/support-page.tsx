import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@thelamp/i18n';
import {
  AuditListResult,
  type SupportGrantResult,
  SupportGrantList,
  SupportGrantResult as GrantSchema,
  type SupportStatusKey,
} from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  type Column,
  Confirm,
  DataTable,
  SelectField,
  StatusBadge,
} from '@thelamp/ui-web';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { PageHeader, Section } from '../people/shared';

const STATUS_BADGE: Record<SupportStatusKey, BadgeVariant> = {
  requested: 'waiting',
  active: 'success',
  declined: 'danger',
  ended: 'neutral',
  expired: 'neutral',
  lapsed: 'neutral',
};

const KEY = ['support-grants'];

/**
 * Vendor support's access to the organisation (module M22, decision D93), for its admins: the
 * requests waiting for a decision, the access open now, and what came before, with what vendor
 * support did under each.
 */
export function SupportPage() {
  const { client } = useApp();
  const { t } = useLanguage();
  const grants = useQuery({
    queryKey: KEY,
    queryFn: () => read(client, '/v1/support-grants', SupportGrantList),
  });
  const items = grants.data?.items ?? [];
  const waiting = items.filter((grant) => grant.status === 'requested');
  const open = items.filter((grant) => grant.status === 'active');
  const earlier = items.filter(
    (grant) => grant.status !== 'requested' && grant.status !== 'active',
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('support.title')} intro={t('support.intro')} />
      {grants.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(grants.error, t)}
        </p>
      ) : !grants.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="ks-muted">{t('support.none')}</p>
      ) : (
        <>
          {waiting.length > 0 ? (
            <Section title={t('support.waiting_title')}>
              {waiting.map((grant) => (
                <Waiting key={grant.id} grant={grant} />
              ))}
            </Section>
          ) : null}
          {open.length > 0 ? (
            <Section title={t('support.open_title')}>
              {open.map((grant) => (
                <Open key={grant.id} grant={grant} />
              ))}
            </Section>
          ) : null}
          {earlier.length > 0 ? <Earlier grants={earlier} /> : null}
        </>
      )}
    </div>
  );
}

/** What vendor support asks for, in the reader's words. */
function useAsks() {
  const { t } = useLanguage();
  return (grant: SupportGrantResult) =>
    t('support.asks', {
      staff: grant.staff.name,
      access: t(`support.access_${grant.scope}`),
      duration: t('support.duration', { count: grant.hours }),
    });
}

/** Writes a decision or an ending, and reads the list again. */
function useGrantChange() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  return async (path: string, body?: unknown) => {
    await write(client, 'POST', path, GrantSchema, body);
    await queryClient.invalidateQueries({ queryKey: KEY });
  };
}

function Waiting({ grant }: { grant: SupportGrantResult }) {
  const { t } = useLanguage();
  const asks = useAsks();
  const change = useGrantChange();
  const [scope, setScope] = useState(grant.scope);
  const [hours, setHours] = useState(grant.hours);
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();

  async function decide(approve: boolean) {
    setBusy(true);
    setFailure(undefined);
    try {
      await change(
        `/v1/support-grants/${grant.id}/decision`,
        approve ? { approve, scope, hours } : { approve },
      );
    } catch (error) {
      setFailure(error);
      setBusy(false);
    }
  }

  return (
    <article className="flex flex-col gap-3 border-t border-[var(--border)] pt-3 first:border-0 first:pt-0">
      <p>{asks(grant)}</p>
      <p className="ks-muted">{t('support.reason', { reason: grant.reason })}</p>
      {grant.emergency ? <p className="ks-muted">{t('support.emergency_note')}</p> : null}
      <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label={t('support.grant_scope')}
          value={scope}
          disabled={grant.scope === 'read'}
          onChange={(event) => setScope(event.target.value as 'read' | 'write')}
          options={[
            { value: 'read', label: t('support.scope_read') },
            ...(grant.scope === 'write'
              ? [{ value: 'write', label: t('support.scope_write') }]
              : []),
          ]}
        />
        <SelectField
          label={t('support.grant_hours')}
          value={String(hours)}
          onChange={(event) => setHours(Number(event.target.value))}
          options={Array.from({ length: grant.hours }, (_, index) => ({
            value: String(index + 1),
            label: t('support.duration', { count: index + 1 }),
          }))}
        />
      </div>
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {declining ? (
        <Confirm
          question={t('support.decline_question', { staff: grant.staff.name })}
          action={
            <Button variant="danger" busy={busy} onClick={() => decide(false)}>
              {t('support.decline')}
            </Button>
          }
          cancel={
            <Button variant="ghost" onClick={() => setDeclining(false)}>
              {t('common.cancel')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" busy={busy} onClick={() => decide(true)}>
            {t('support.approve')}
          </Button>
          <Button variant="secondary" onClick={() => setDeclining(true)}>
            {t('support.decline')}
          </Button>
        </div>
      )}
    </article>
  );
}

function Open({ grant }: { grant: SupportGrantResult }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const change = useGrantChange();
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const scope = grant.grantedScope ?? grant.scope;

  async function end() {
    setBusy(true);
    setFailure(undefined);
    try {
      await change(`/v1/support-grants/${grant.id}/end`);
    } catch (error) {
      setFailure(error);
      setBusy(false);
    }
  }

  return (
    <article className="flex flex-col gap-3 border-t border-[var(--border)] pt-3 first:border-0 first:pt-0">
      <p className="font-semibold">{grant.staff.name}</p>
      <p>
        {t('support.until', {
          access: t(`support.scope_${scope}`),
          time: formatDateTime(grant.endsAt!, { locale, timeZone: access.timezone }),
        })}
      </p>
      <p className="ks-muted">{t('support.reason', { reason: grant.reason })}</p>
      {grant.approvedBy ? (
        <p className="ks-muted">{t('support.approved_by', { name: grant.approvedBy.name })}</p>
      ) : null}
      {grant.emergency ? <p className="ks-muted">{t('support.emergency_note')}</p> : null}
      {access.can('audit.view') ? <Activity grantId={grant.id} /> : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {ending ? (
        <Confirm
          question={t('support.end_question', { staff: grant.staff.name })}
          action={
            <Button variant="danger" busy={busy} onClick={end}>
              {t('support.end')}
            </Button>
          }
          cancel={
            <Button variant="ghost" onClick={() => setEnding(false)}>
              {t('common.cancel')}
            </Button>
          }
        />
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setEnding(true)}>
          {t('support.end')}
        </Button>
      )}
    </article>
  );
}

/** What vendor support did under one grant, from the audit log, newest first. */
function Activity({ grantId }: { grantId: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const activity = useQuery({
    queryKey: [...KEY, grantId, 'activity'],
    queryFn: () => read(client, `/v1/audit?supportGrantId=${grantId}&limit=50`, AuditListResult),
  });
  const entries = activity.data?.items ?? [];
  return (
    <details>
      <summary className="cursor-pointer">{t('support.activity')}</summary>
      {activity.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(activity.error, t)}
        </p>
      ) : entries.length === 0 ? (
        <p className="ks-muted">
          {activity.data ? t('support.activity_none') : t('common.loading')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap gap-3">
              <span className="ks-muted tabular-nums">
                {formatDateTime(entry.createdAt, { locale, timeZone: access.timezone })}
              </span>
              <code>{entry.action}</code>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function Earlier({ grants }: { grants: SupportGrantResult[] }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const columns: Column<SupportGrantResult>[] = [
    { key: 'staff', header: t('support.col_staff'), render: (row) => row.staff.name },
    {
      key: 'access',
      header: t('support.grant_scope'),
      render: (row) => t(`support.scope_${row.grantedScope ?? row.scope}`),
    },
    {
      key: 'status',
      header: t('support.col_status'),
      render: (row) => (
        <StatusBadge variant={STATUS_BADGE[row.status]}>
          {t(`support.status_${row.status}`)}
        </StatusBadge>
      ),
    },
    {
      key: 'asked',
      header: t('support.col_asked'),
      render: (row) => formatDateTime(row.createdAt, { locale, timeZone: access.timezone }),
    },
    { key: 'reason', header: t('support.col_reason'), render: (row) => row.reason },
    {
      key: 'closed',
      header: t('support.col_closed'),
      render: (row) => row.closedBy?.name ?? '—',
    },
  ];
  return (
    <Section title={t('support.past_title')}>
      <DataTable
        caption={t('support.past_title')}
        columns={columns}
        rows={grants}
        rowKey={(row) => row.id}
      />
    </Section>
  );
}
