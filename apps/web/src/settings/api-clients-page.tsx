import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@thelamp/i18n';
import {
  API_SCOPE_KEYS,
  ApiClientList,
  type ApiClientResult,
  ApiClientResult as ClientSchema,
  ApiClientSecret,
  newId,
} from '@thelamp/shared';
import {
  Button,
  Checkbox,
  ChoiceGroup,
  type Column,
  Confirm,
  DataTable,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { type FormEvent, useState } from 'react';
import { apiAddresses } from '../client';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { Facts, fieldErrors, Section } from '../people/shared';
import { Copyable, SecretPanel } from './secret';

const KEY = ['api-clients'];

/** The new key's form, which the Developers page's Create a key goes to. */
export const NEW_KEY = 'new-key';

type ApiScope = (typeof API_SCOPE_KEYS)[number];

/** The resources scopes are about, in the order the API lists them, with the access each has. */
const RESOURCES = API_SCOPE_KEYS.reduce<{ resource: string; scopes: ApiScope[] }[]>(
  (groups, scope) => {
    const resource = scope.split(':')[0]!;
    const group = groups.find((item) => item.resource === resource);
    if (group) group.scopes.push(scope);
    else groups.push({ resource, scopes: [scope] });
    return groups;
  },
  [],
);

/** A scope in the reader's words, such as "People: write". */
function scopeName(t: ReturnType<typeof useLanguage>['t'], scope: ApiScope) {
  const [resource, access] = scope.split(':') as [string, 'read' | 'write'];
  return t('api_clients.scope', {
    resource: t(`api_clients.resource_${resource}` as never),
    access: t(`api_clients.${access}`),
  });
}

/**
 * API clients (module M20, decision D94), for holders of `api_client.manage`, on the Developers
 * page: the clients the organisation's own systems connect as with their scopes, making,
 * re-keying and revoking them, and how to connect. A secret is shown once, when it is made.
 */
export function ApiClients() {
  const { client } = useApp();
  const { t } = useLanguage();
  const clients = useQuery({
    queryKey: KEY,
    queryFn: () => read(client, '/v1/api-clients', ApiClientList),
  });
  const [shown, setShown] = useState<{ client: ApiClientResult; clientSecret: string }>();
  const addresses = apiAddresses(client);
  return (
    <>
      {shown ? (
        <SecretPanel
          title={t('api_clients.secret_title', { name: shown.client.name })}
          warning={t('api_clients.secret_once')}
          values={[
            [t('api_clients.client_id'), shown.client.clientId],
            [t('api_clients.client_secret'), shown.clientSecret],
          ]}
          done={t('api_clients.done')}
          onDone={() => setShown(undefined)}
        />
      ) : null}
      <Section title={t('api_clients.list_title')}>
        {clients.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(clients.error, t)}
          </p>
        ) : !clients.data ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : (
          <Clients clients={clients.data.items} onRotated={setShown} />
        )}
      </Section>
      <Section title={t('api_clients.connect_title')}>
        <p className="ks-muted">{t('api_clients.connect_intro')}</p>
        <Facts
          items={[
            [
              t('api_clients.token_url'),
              <Copyable
                key="token"
                label={t('api_clients.token_url')}
                value={addresses.tokenUrl}
              />,
            ],
            [
              t('api_clients.api_url'),
              <Copyable key="api" label={t('api_clients.api_url')} value={addresses.apiUrl} />,
            ],
            [
              t('api_clients.docs'),
              <a
                key="docs"
                className="font-semibold text-[var(--accent)] underline"
                href={addresses.docsUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t('api_clients.docs_link')}
              </a>,
            ],
          ]}
        />
      </Section>
      <NewClient onMade={setShown} />
    </>
  );
}

function NewClient({
  onMade,
}: {
  onMade: (made: { client: ApiClientResult; clientSecret: string }) => void;
}) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  // The client's own ID, kept until it is made, so a retried request makes it once.
  const [id, setId] = useState(newId);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  function toggle(scope: ApiScope, on: boolean) {
    setScopes((now) => (on ? [...now, scope] : now.filter((item) => item !== scope)));
  }

  async function make(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFailure(undefined);
    if (scopes.length === 0) {
      setErrors({ scopes: t('api_clients.scopes_needed') });
      return;
    }
    setBusy(true);
    try {
      const made = await write(client, 'POST', '/v1/api-clients', ApiClientSecret, {
        id,
        name: name.trim(),
        scopes: API_SCOPE_KEYS.filter((scope) => scopes.includes(scope)),
      });
      await queryClient.invalidateQueries({ queryKey: KEY });
      if (made) onMade(made);
      setId(newId());
      setName('');
      setScopes([]);
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('api_clients.new_title')} className="scroll-mt-4">
      <form id={NEW_KEY} className="flex flex-col gap-4" onSubmit={make} noValidate>
        <TextField
          className="max-w-md"
          label={t('api_clients.name')}
          help={t('api_clients.name_help')}
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          {...(errors.name ? { error: errors.name } : {})}
        />
        <ChoiceGroup
          legend={t('api_clients.scopes')}
          {...(errors.scopes ? { error: errors.scopes } : {})}
        >
          <p className="ks-help">{t('api_clients.scopes_help')}</p>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
            {RESOURCES.map(({ resource, scopes: offered }) => (
              <div key={resource} className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  {t(`api_clients.resource_${resource}` as never)}
                </span>
                <span className="ks-help">
                  {t(`api_clients.resource_${resource}_help` as never)}
                </span>
                <div className="flex flex-wrap gap-x-4">
                  {offered.map((scope) => (
                    <Checkbox
                      key={scope}
                      label={t(`api_clients.${scope.split(':')[1] as 'read' | 'write'}`)}
                      aria-label={scopeName(t, scope)}
                      checked={scopes.includes(scope)}
                      onChange={(event) => toggle(scope, event.target.checked)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ChoiceGroup>
        {failure && Object.keys(errors).length === 0 ? (
          <p className="ks-help error" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="self-start" busy={busy}>
          {t('api_clients.create')}
        </Button>
      </form>
    </Section>
  );
}

function Clients({
  clients,
  onRotated,
}: {
  clients: ApiClientResult[];
  onRotated: (made: { client: ApiClientResult; clientSecret: string }) => void;
}) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const columns: Column<ApiClientResult>[] = [
    {
      key: 'name',
      header: t('api_clients.col_name'),
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-semibold">{row.name}</span>
          <code className="ks-muted break-all">{row.clientId}</code>
        </span>
      ),
    },
    {
      key: 'scopes',
      header: t('api_clients.col_scopes'),
      render: (row) => row.scopes.map((scope) => scopeName(t, scope)).join(', '),
    },
    {
      key: 'used',
      header: t('api_clients.col_last_used'),
      render: (row) =>
        row.lastUsedAt
          ? formatDateTime(row.lastUsedAt, { locale, timeZone: access.timezone })
          : t('api_clients.never'),
    },
    {
      key: 'status',
      header: t('api_clients.col_status'),
      render: (row) => (
        <StatusBadge variant={row.status === 'active' ? 'success' : 'neutral'}>
          {t(`api_clients.status_${row.status}`)}
        </StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: t('api_clients.col_actions'),
      render: (row) =>
        row.status === 'active' ? <ClientActions apiClient={row} onRotated={onRotated} /> : null,
    },
  ];
  return (
    <DataTable
      caption={t('api_clients.list_title')}
      columns={columns}
      rows={clients}
      rowKey={(row) => row.id}
      empty={<p className="ks-muted">{t('api_clients.none')}</p>}
    />
  );
}

function ClientActions({
  apiClient,
  onRotated,
}: {
  apiClient: ApiClientResult;
  onRotated: (made: { client: ApiClientResult; clientSecret: string }) => void;
}) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [asking, setAsking] = useState<'rotate' | 'revoke'>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();

  async function act(kind: 'rotate' | 'revoke') {
    setBusy(true);
    setFailure(undefined);
    try {
      if (kind === 'rotate') {
        const rotated = await write(
          client,
          'POST',
          `/v1/api-clients/${apiClient.id}/rotate`,
          ApiClientSecret,
        );
        if (rotated) onRotated(rotated);
      } else {
        await write(client, 'POST', `/v1/api-clients/${apiClient.id}/revoke`, ClientSchema);
      }
      setAsking(undefined);
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {asking ? (
        <Confirm
          question={t(`api_clients.${asking}_question`, { name: apiClient.name })}
          action={
            <Button
              size="sm"
              variant={asking === 'revoke' ? 'danger' : 'primary'}
              busy={busy}
              onClick={() => act(asking)}
            >
              {t(`api_clients.${asking}`)}
            </Button>
          }
          cancel={
            <Button size="sm" variant="ghost" onClick={() => setAsking(undefined)}>
              {t('common.cancel')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAsking('rotate')}>
            {t('api_clients.rotate')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking('revoke')}>
            {t('api_clients.revoke')}
          </Button>
        </div>
      )}
    </div>
  );
}
