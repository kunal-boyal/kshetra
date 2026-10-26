import { formatDate, formatDateTime } from '@thelamp/i18n';
import {
  type ConsoleTenant,
  type DataExportResult,
  DataExportResult as ResultSchema,
  deletionDue,
  newId,
} from '@thelamp/shared';
import { Button, Card, Confirm, TextAreaField, TextField } from '@thelamp/ui-web';
import { useState } from 'react';
import { useConsole } from '../context';
import { useConsoleMutations, useTenantExports } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { holds, VIEWER_TIME_ZONE } from './shared';

/**
 * Terminating a tenant (module M22, decision D95): for a suspended tenant, terminating it after
 * its slug is typed; once terminated, the exports for the customer with a day's link to copy,
 * another export, and undoing it until the data is deleted 30 days on; after that, when it went.
 */
export function TerminationCard({ tenant }: { tenant: ConsoleTenant }) {
  const { client } = useConsole();
  const { t, locale } = useLanguage();
  if (!holds(client.staff, 'platform.tenant.manage')) return null;
  const day = (time: string) => formatDate(time.slice(0, 10), { locale });
  if (tenant.deletedAt) {
    return (
      <Card>
        <section className="flex flex-col gap-2" aria-label={t('console.termination_title')}>
          <h2 className="heading-md">{t('console.termination_title')}</h2>
          <p>{t('console.deleted_on', { date: day(tenant.deletedAt) })}</p>
        </section>
      </Card>
    );
  }
  if (tenant.status === 'terminated' && tenant.terminatedAt && tenant.deletesAt) {
    return (
      <Card>
        <section className="flex flex-col gap-4" aria-label={t('console.termination_title')}>
          <h2 className="heading-md">{t('console.termination_title')}</h2>
          <p>
            {t('console.terminated_on', {
              date: day(tenant.terminatedAt),
              deletes: day(tenant.deletesAt),
            })}
          </p>
          <Exports tenantId={tenant.id} />
          <Undo tenant={tenant} />
        </section>
      </Card>
    );
  }
  if (tenant.status !== 'suspended') return null;
  return <Terminate tenant={tenant} />;
}

function Terminate({ tenant }: { tenant: ConsoleTenant }) {
  const { t, locale } = useLanguage();
  const { terminate } = useConsoleMutations();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [slug, setSlug] = useState('');
  const [failure, setFailure] = useState<string>();
  // The day the data would go, worked out when the question is asked.
  const [deletes, setDeletes] = useState('');
  return (
    <Card>
      <section className="flex flex-col gap-3" aria-label={t('console.termination_title')}>
        <h2 className="heading-md">{t('console.termination_title')}</h2>
        <p className="ks-muted">{t('console.termination_intro', { name: tenant.name })}</p>
        {failure ? (
          <p className="ks-help error" role="alert">
            {failure}
          </p>
        ) : null}
        {asking ? (
          <Confirm
            question={t('console.terminate_question', {
              name: tenant.name,
              date: formatDate(deletes, { locale }),
            })}
            action={
              <Button
                variant="danger"
                busy={terminate.isPending}
                disabled={reason.trim().length < 3 || slug.trim() !== tenant.slug}
                onClick={async () => {
                  setFailure(undefined);
                  try {
                    await terminate.mutateAsync({
                      id: tenant.id,
                      reason: reason.trim(),
                      confirmSlug: slug.trim(),
                    });
                  } catch (error) {
                    setFailure(errorMessage(error, t));
                  }
                }}
              >
                {t('console.terminate')}
              </Button>
            }
            cancel={
              <Button variant="ghost" onClick={() => setAsking(false)}>
                {t('common.cancel')}
              </Button>
            }
          >
            <TextAreaField
              label={t('console.terminate_reason')}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
            <TextField
              label={t('console.terminate_slug', { slug: tenant.slug })}
              value={slug}
              autoComplete="off"
              onChange={(event) => setSlug(event.target.value)}
              required
            />
          </Confirm>
        ) : (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              setDeletes(deletionDue(new Date()).toISOString().slice(0, 10));
              setAsking(true);
            }}
          >
            {t('console.terminate')}
          </Button>
        )}
      </section>
    </Card>
  );
}

function Exports({ tenantId }: { tenantId: string }) {
  const { t, locale } = useLanguage();
  const exports = useTenantExports(tenantId, true);
  const { requestExport } = useConsoleMutations();
  const [failure, setFailure] = useState<string>();
  const items = exports.data?.items ?? [];
  const preparing = items.some((item) => item.status === 'queued' || item.status === 'running');
  return (
    <div className="flex flex-col gap-3">
      <h3 className="label-lg">{t('console.final_exports')}</h3>
      {exports.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(exports.error, t)}
        </p>
      ) : !exports.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="ks-muted">{t('console.no_exports')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1">
              <span>
                {t('console.export_by', {
                  time: formatDateTime(item.createdAt, { locale, timeZone: VIEWER_TIME_ZONE }),
                  name: item.requestedBy.name,
                })}
                {' · '}
                {t(`data_export.status_${item.status}`)}
              </span>
              {item.status === 'ready' ? <Link tenantId={tenantId} item={item} /> : null}
            </li>
          ))}
        </ul>
      )}
      {failure ? (
        <p className="ks-help error" role="alert">
          {failure}
        </p>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        disabled={preparing}
        busy={requestExport.isPending}
        onClick={async () => {
          setFailure(undefined);
          try {
            await requestExport.mutateAsync({ id: tenantId, exportId: newId() });
          } catch (error) {
            setFailure(errorMessage(error, t));
          }
        }}
      >
        {t('console.export_again')}
      </Button>
    </div>
  );
}

/** A day's link, asked for when pressed, so each one is in the tenant's audit log. */
function Link({ tenantId, item }: { tenantId: string; item: DataExportResult }) {
  const { client } = useConsole();
  const { t } = useLanguage();
  const [url, setUrl] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<string>();
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={async () => {
          setFailure(undefined);
          try {
            const found = await client.request(
              'GET',
              `/platform/v1/tenants/${tenantId}/data-exports/${item.id}`,
              ResultSchema,
            );
            if (!found.download) return;
            setUrl(found.download.url);
            await navigator.clipboard.writeText(found.download.url).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          } catch (error) {
            setFailure(errorMessage(error, t));
          }
        }}
      >
        {t('console.copy_export_link')}
      </Button>
      {url ? (
        <TextField
          label={t('console.link_label')}
          value={url}
          readOnly
          onFocus={(event) => event.target.select()}
          {...(copied ? { help: t('console.link_copied') } : {})}
        />
      ) : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

function Undo({ tenant }: { tenant: ConsoleTenant }) {
  const { t } = useLanguage();
  const { undoTermination } = useConsoleMutations();
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string>();
  return (
    <div className="flex flex-col gap-2">
      {failure ? (
        <p className="ks-help error" role="alert">
          {failure}
        </p>
      ) : null}
      {asking ? (
        <Confirm
          question={t('console.undo_question', { name: tenant.name })}
          action={
            <Button
              variant="primary"
              busy={undoTermination.isPending}
              onClick={async () => {
                setFailure(undefined);
                try {
                  await undoTermination.mutateAsync(tenant.id);
                  setAsking(false);
                } catch (error) {
                  setFailure(errorMessage(error, t));
                }
              }}
            >
              {t('console.undo_termination')}
            </Button>
          }
          cancel={
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t('common.cancel')}
            </Button>
          }
        />
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setAsking(true)}>
          {t('console.undo_termination')}
        </Button>
      )}
    </div>
  );
}
