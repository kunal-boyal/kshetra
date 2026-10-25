import { formatDateTime } from '@thelamp/i18n';
import {
  type ConsoleTenant,
  SUPPORT_DEFAULT_HOURS,
  SUPPORT_EMERGENCY_MAX_HOURS,
  SUPPORT_MAX_HOURS,
  type SupportGrantResult,
  type SupportStatusKey,
} from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  Card,
  Checkbox,
  type Column,
  Confirm,
  DataTable,
  Notice,
  SelectField,
  StatusBadge,
  TextAreaField,
} from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useConsole } from '../context';
import { useConsoleMutations, useSupportGrants } from '../data';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';
import { holds, VIEWER_TIME_ZONE } from './shared';

const STATUS_BADGE: Record<SupportStatusKey, BadgeVariant> = {
  requested: 'waiting',
  active: 'success',
  declined: 'danger',
  ended: 'neutral',
  expired: 'neutral',
  lapsed: 'neutral',
};

/**
 * Where the browser goes into a tenant's portal: a tab opened at the click, so no pop-up blocker
 * stops it, then sent to the one-time link once the console has it. A seam, so tests can watch it.
 */
export const portal = {
  async open(link: () => Promise<string>): Promise<void> {
    const tab = window.open('about:blank', '_blank');
    try {
      const url = await link();
      if (!tab) {
        window.location.assign(url);
        return;
      }
      tab.opener = null;
      tab.location.href = url;
    } catch (error) {
      tab?.close();
      throw error;
    }
  },
};

/**
 * Support access (module M22, decision D93): every request and grant, or only the signed-in staff
 * member's, with what each may do next.
 */
export function SupportPage() {
  const { t } = useLanguage();
  const [mine, setMine] = useState(false);
  const grants = useSupportGrants({ mine });
  return (
    <>
      <h1 className="heading-xl">{t('console.support')}</h1>
      <p className="ks-muted">{t('console.support_intro')}</p>
      <Checkbox
        label={t('console.support_mine')}
        checked={mine}
        onChange={(event) => setMine(event.target.checked)}
      />
      <GrantsTable query={grants} showTenant />
    </>
  );
}

/** A tenant's requests and grants, and asking for access to it, on the tenant's page. */
export function SupportCard({ tenant }: { tenant: ConsoleTenant }) {
  const { client } = useConsole();
  const { t } = useLanguage();
  const grants = useSupportGrants({ tenantId: tenant.id });
  if (!holds(client.staff, 'platform.support.request')) return null;
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="heading-md">{t('console.support')}</h2>
      <GrantsTable query={grants} />
      <AskForm tenant={tenant} />
    </Card>
  );
}

function GrantsTable({
  query,
  showTenant = false,
}: {
  query: ReturnType<typeof useSupportGrants>;
  showTenant?: boolean;
}) {
  const { t, locale } = useLanguage();
  const [failure, setFailure] = useState<string>();
  const moment = (iso: string) => formatDateTime(iso, { locale, timeZone: VIEWER_TIME_ZONE });
  if (query.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(query.error, t)}
      </p>
    );
  }
  if (!query.data) return <p className="ks-muted">{t('common.loading')}</p>;
  if (query.data.items.length === 0) return <p className="ks-muted">{t('console.support_none')}</p>;
  const columns: Column<SupportGrantResult>[] = [
    ...(showTenant
      ? [
          {
            key: 'tenant',
            header: t('console.col_tenant'),
            render: (row: SupportGrantResult) => (
              <Link to="/tenants/$tenantId" params={{ tenantId: row.tenant.id }}>
                {row.tenant.name}
              </Link>
            ),
          },
        ]
      : []),
    { key: 'staff', header: t('console.col_staff'), render: (row) => row.staff.name },
    {
      key: 'access',
      header: t('console.col_access'),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          {t(`console.support_scope_${row.grantedScope ?? row.scope}`)}
          {row.emergency ? (
            <StatusBadge variant="danger">{t('console.support_emergency_tag')}</StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('console.col_status'),
      render: (row) => (
        <StatusBadge variant={STATUS_BADGE[row.status]}>
          {t(`console.support_status_${row.status}`)}
        </StatusBadge>
      ),
    },
    {
      key: 'until',
      header: t('console.col_until'),
      render: (row) => (row.endsAt ? moment(row.endsAt) : '—'),
    },
    { key: 'reason', header: t('console.col_reason'), render: (row) => row.reason },
    {
      key: 'actions',
      header: t('console.col_actions'),
      render: (row) => <GrantActions grant={row} onFailure={setFailure} />,
    },
  ];
  return (
    <>
      {failure ? (
        <p className="ks-help error" role="alert">
          {failure}
        </p>
      ) : null}
      <DataTable
        caption={t('console.support')}
        columns={columns}
        rows={query.data.items}
        rowKey={(row) => row.id}
      />
    </>
  );
}

/**
 * What the signed-in staff member may do with a grant: open the portal under their own open
 * grant, end theirs (or anyone's, as a vendor admin), and approve another's emergency request.
 */
function GrantActions({
  grant,
  onFailure,
}: {
  grant: SupportGrantResult;
  onFailure: (message: string | undefined) => void;
}) {
  const { client } = useConsole();
  const { t } = useLanguage();
  const { approveSupport, endSupport, supportEntry } = useConsoleMutations();
  const [asking, setAsking] = useState<'end' | 'approve'>();
  const mine = grant.staff.id === client.staff?.id;
  const admin = holds(client.staff, 'platform.support.approve_emergency');
  const live = grant.status === 'requested' || grant.status === 'active';
  const canApprove = admin && !mine && grant.emergency && grant.status === 'requested';

  async function act(work: () => Promise<unknown>) {
    onFailure(undefined);
    try {
      await work();
      setAsking(undefined);
    } catch (error) {
      onFailure(errorMessage(error, t));
    }
  }

  if (asking) {
    const ending = asking === 'end';
    return (
      <Confirm
        question={
          ending
            ? t('console.support_end_question', {
                name: grant.staff.name,
                tenant: grant.tenant.name,
              })
            : t('console.support_approve_question', {
                name: grant.staff.name,
                tenant: grant.tenant.name,
                duration: t('support.duration', { count: grant.hours }),
              })
        }
        action={
          <Button
            variant={ending ? 'danger' : 'primary'}
            busy={ending ? endSupport.isPending : approveSupport.isPending}
            onClick={() =>
              act(() =>
                ending ? endSupport.mutateAsync(grant.id) : approveSupport.mutateAsync(grant.id),
              )
            }
          >
            {t(ending ? 'console.support_end' : 'console.support_approve')}
          </Button>
        }
        cancel={
          <Button variant="ghost" onClick={() => setAsking(undefined)}>
            {t('common.cancel')}
          </Button>
        }
      />
    );
  }
  return (
    <span className="flex flex-wrap gap-2">
      {mine && grant.status === 'active' ? (
        <Button
          size="sm"
          variant="primary"
          busy={supportEntry.isPending}
          onClick={() =>
            act(() => portal.open(async () => (await supportEntry.mutateAsync(grant.id)).url))
          }
        >
          {t('console.support_open')}
        </Button>
      ) : null}
      {canApprove ? (
        <Button size="sm" variant="secondary" onClick={() => setAsking('approve')}>
          {t('console.support_approve')}
        </Button>
      ) : null}
      {live && (mine || admin) ? (
        <Button size="sm" variant="ghost" onClick={() => setAsking('end')}>
          {t('console.support_end')}
        </Button>
      ) : null}
    </span>
  );
}

/** Asking for access to a tenant: why, to see or change, for how long, and whether urgent. */
function AskForm({ tenant }: { tenant: ConsoleTenant }) {
  const { t } = useLanguage();
  const { askSupport } = useConsoleMutations();
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [hours, setHours] = useState(SUPPORT_DEFAULT_HOURS);
  const [emergency, setEmergency] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();
  const [asked, setAsked] = useState<'ordinary' | 'emergency'>();
  const most = emergency ? SUPPORT_EMERGENCY_MAX_HOURS : SUPPORT_MAX_HOURS;

  async function send(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFailure(undefined);
    setAsked(undefined);
    try {
      await askSupport.mutateAsync({
        tenantId: tenant.id,
        reason: reason.trim(),
        scope: emergency ? 'read' : scope,
        hours: Math.min(hours, most),
        emergency,
      });
      setAsked(emergency ? 'emergency' : 'ordinary');
      setReason('');
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error, t));
    }
  }

  return (
    <form className="flex max-w-xl flex-col gap-4" onSubmit={send} noValidate>
      <h3 className="heading-md">{t('console.support_ask_title')}</h3>
      <TextAreaField
        label={t('console.support_reason')}
        help={t('console.support_reason_help')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={errors.reason}
        rows={2}
        required
      />
      <Checkbox
        label={t('console.support_emergency')}
        detail={t('console.support_emergency_help')}
        checked={emergency}
        onChange={(event) => setEmergency(event.target.checked)}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label={t('console.support_scope')}
          value={emergency ? 'read' : scope}
          disabled={emergency}
          onChange={(event) => setScope(event.target.value as 'read' | 'write')}
          options={[
            { value: 'read', label: t('console.support_scope_read') },
            { value: 'write', label: t('console.support_scope_write') },
          ]}
          error={errors.scope}
        />
        <SelectField
          label={t('console.support_hours')}
          value={String(Math.min(hours, most))}
          onChange={(event) => setHours(Number(event.target.value))}
          options={Array.from({ length: most }, (_, index) => ({
            value: String(index + 1),
            label: t('support.duration', { count: index + 1 }),
          }))}
          error={errors.hours}
        />
      </div>
      {failure && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {failure}
        </p>
      ) : null}
      {asked ? (
        <Notice>
          {t(asked === 'emergency' ? 'console.support_asked_emergency' : 'console.support_asked')}
        </Notice>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        className="self-start"
        busy={askSupport.isPending}
        disabled={reason.trim().length < 10}
      >
        {t('console.support_ask')}
      </Button>
    </form>
  );
}
