import { useApp } from '../context';
import { apiAddresses } from '../client';
import { useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader } from '../people/shared';
import { ApiClients, NEW_KEY } from './api-clients-page';
import { Webhooks } from './webhooks-page';

/**
 * API and webhooks (decision D104): the keys the organisation's own systems connect with, and the
 * webhooks that tell them what happened, on one page. Each part needs its own permission.
 */
export function DevelopersPage() {
  const { client } = useApp();
  const { t } = useLanguage();
  const access = useAccess();
  const keys = access.can('api_client.manage');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('developers.title')} intro={t('developers.intro')}>
        <a
          className="ks-btn secondary sm"
          href={apiAddresses(client).docsUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t('developers.reference')}
        </a>
        {keys ? (
          <a className="ks-btn primary sm" href={`#${NEW_KEY}`}>
            {t('developers.create_key')}
          </a>
        ) : null}
      </PageHeader>
      {keys ? <ApiClients /> : null}
      {access.can('webhook.manage') ? <Webhooks /> : null}
      {!keys && !access.can('webhook.manage') ? (
        <p className="ks-muted">{t('admin.no_access')}</p>
      ) : null}
    </div>
  );
}
