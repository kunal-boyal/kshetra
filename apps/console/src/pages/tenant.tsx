import { Link } from '@tanstack/react-router';
import { formatDate, formatDateTime } from '@thelamp/i18n';
import { Button, Card, Confirm, TextAreaField } from '@thelamp/ui-web';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useConsole } from '../context';
import { useConsoleMutations, useTenant } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { holds, TenantStatusBadge, VIEWER_TIME_ZONE } from './shared';

/** One tenant: where it lives, what it started from, its trial, and suspending or reopening it. */
export function TenantPage({ tenantId }: { tenantId: string }) {
  const { client } = useConsole();
  const { t, locale } = useLanguage();
  const tenant = useTenant(tenantId);
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
  const facts: [string, string][] = [
    [t('console.col_slug'), row.slug],
    [t('console.col_template'), `${row.template.key} (v${row.template.version})`],
    [
      t('console.col_cell'),
      `${row.cell.name} · ${row.cell.region} · ${t(`console.cell_${row.cell.kind}`)}`,
    ],
    [t('console.col_users'), String(row.activeUsers)],
    [
      t('console.col_trial_ends'),
      row.trialEndsAt ? formatDate(row.trialEndsAt.slice(0, 10), { locale }) : '—',
    ],
    [t('console.created'), formatDateTime(row.createdAt, { locale, timeZone: VIEWER_TIME_ZONE })],
  ];

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

  return (
    <>
      <Link to="/" className="ks-btn ghost sm self-start">
        <ArrowLeft size={16} aria-hidden="true" />
        {t('console.tenants')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="heading-xl">{row.name}</h1>
        <TenantStatusBadge status={row.status} />
        {row.demo ? <span className="ks-muted">{t('console.demo')}</span> : null}
      </div>
      <Card>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1">
              <dt className="ks-muted caption">{label}</dt>
              <dd className="m-0">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {failure ? (
        <p className="ks-help error" role="alert">
          {failure}
        </p>
      ) : null}
      {manages && row.status === 'suspended' ? (
        <Button
          variant="primary"
          className="self-start"
          busy={reactivate.isPending}
          onClick={() => act(() => reactivate.mutateAsync(row.id))}
        >
          {t('console.reactivate')}
        </Button>
      ) : null}
      {manages && row.status !== 'suspended' && row.status !== 'terminated' ? (
        asking ? (
          <Confirm
            question={t('console.suspend_question', { name: row.name })}
            action={
              <Button
                variant="danger"
                busy={suspend.isPending}
                disabled={reason.trim().length < 3}
                onClick={() =>
                  act(() => suspend.mutateAsync({ id: row.id, reason: reason.trim() }))
                }
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
          <Button variant="secondary" className="self-start" onClick={() => setAsking(true)}>
            {t('console.suspend')}
          </Button>
        )
      ) : null}
    </>
  );
}
