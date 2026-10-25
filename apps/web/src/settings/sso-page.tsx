import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type SsoConnectionResult, SsoConnectionResult as Result } from '@thelamp/shared';
import { Button, Checkbox, SelectField, TextAreaField, TextField } from '@thelamp/ui-web';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, write } from '../people/data';
import { Facts, fieldErrors, PageHeader, Section } from '../people/shared';

/**
 * Single sign-on for the portal (spec M1, D5, decision D91), on the SSO module: what the
 * organisation's identity provider needs from us, and the connection to it. Secrets never come
 * back; leaving one blank keeps the one saved.
 */
export function SsoPage() {
  const { client } = useApp();
  const { t } = useLanguage();
  const sso = useQuery({
    queryKey: ['sso'],
    queryFn: () => read(client, '/v1/sso', Result),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('sso.title')} intro={t('sso.intro')} />
      {sso.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(sso.error, t)}
        </p>
      ) : !sso.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          <ProviderSection provider={sso.data.provider} />
          <ConnectionForm current={sso.data} />
        </>
      )}
    </div>
  );
}

/** A value the identity provider's admin copies, with a button to copy it. */
function Copyable({ label, value }: { label: string; value: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <code className="break-all">{value}</code>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t('sso.copy', { name: label })}
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? t('sso.copied') : t('sso.copy_button')}
      </Button>
    </div>
  );
}

function ProviderSection({ provider }: { provider: SsoConnectionResult['provider'] }) {
  const { t } = useLanguage();
  const items: [string, string][] = [
    [t('sso.redirect_uri'), provider.redirectUri],
    [t('sso.entity_id'), provider.entityId],
    [t('sso.acs_url'), provider.acsUrl],
    [t('sso.metadata_url'), provider.metadataUrl],
  ];
  return (
    <Section title={t('sso.provider_title')}>
      <p className="ks-muted">{t('sso.provider_intro')}</p>
      <Facts
        items={items.map(([label, value]) => [
          label,
          <Copyable key={label} label={label} value={value} />,
        ])}
      />
    </Section>
  );
}

function ConnectionForm({ current }: { current: SsoConnectionResult }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const saved = current.connection;
  const [draft, setDraft] = useState({
    protocol: saved?.protocol ?? ('oidc' as 'oidc' | 'saml'),
    issuer: saved?.issuer ?? '',
    clientId: saved?.clientId ?? '',
    clientSecret: '',
    entryPoint: saved?.entryPoint ?? '',
    idpIssuer: saved?.idpIssuer ?? '',
    idpCertificate: '',
    domains: (saved?.domains ?? []).join('\n'),
    enabled: saved?.enabled ?? false,
    enforced: saved?.enforced ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const change = (patch: Partial<typeof draft>) => {
    setDone(false);
    setDraft((now) => ({ ...now, ...patch }));
  };
  // A secret already saved for the same protocol may be left blank.
  const keepsSecret = saved?.protocol === 'oidc' && saved.hasClientSecret;
  const keepsCertificate = saved?.protocol === 'saml' && saved.hasIdpCertificate;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure(undefined);
    try {
      const settings =
        draft.protocol === 'oidc'
          ? {
              protocol: 'oidc' as const,
              issuer: draft.issuer.trim(),
              clientId: draft.clientId.trim(),
              ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
            }
          : {
              protocol: 'saml' as const,
              entryPoint: draft.entryPoint.trim(),
              idpIssuer: draft.idpIssuer.trim(),
              ...(draft.idpCertificate.trim()
                ? { idpCertificate: draft.idpCertificate.trim() }
                : {}),
            };
      const result = await write(client, 'PUT', '/v1/sso', Result, {
        settings,
        domains: draft.domains
          .split(/[\s,]+/)
          .map((domain) => domain.trim().toLowerCase())
          .filter(Boolean),
        enabled: draft.enabled,
        enforced: draft.enabled && draft.enforced,
      });
      queryClient.setQueryData(['sso'], result);
      change({ clientSecret: '', idpCertificate: '' });
      setDone(true);
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('sso.connection')}>
      <form className="flex max-w-xl flex-col gap-4" onSubmit={save} noValidate>
        <SelectField
          label={t('sso.protocol')}
          value={draft.protocol}
          onChange={(event) => change({ protocol: event.target.value as 'oidc' | 'saml' })}
          options={[
            { value: 'oidc', label: 'OIDC' },
            { value: 'saml', label: 'SAML' },
          ]}
        />
        {draft.protocol === 'oidc' ? (
          <>
            <TextField
              label={t('sso.issuer')}
              help={t('sso.issuer_help')}
              type="url"
              value={draft.issuer}
              onChange={(event) => change({ issuer: event.target.value })}
              error={errors['settings.issuer']}
              required
            />
            <TextField
              label={t('sso.client_id')}
              value={draft.clientId}
              onChange={(event) => change({ clientId: event.target.value })}
              error={errors['settings.clientId']}
              required
            />
            <TextField
              label={t('sso.client_secret')}
              type="password"
              autoComplete="off"
              help={keepsSecret ? t('sso.kept') : undefined}
              value={draft.clientSecret}
              onChange={(event) => change({ clientSecret: event.target.value })}
              error={errors['settings.clientSecret']}
              required={!keepsSecret}
            />
          </>
        ) : (
          <>
            <TextField
              label={t('sso.entry_point')}
              type="url"
              value={draft.entryPoint}
              onChange={(event) => change({ entryPoint: event.target.value })}
              error={errors['settings.entryPoint']}
              required
            />
            <TextField
              label={t('sso.idp_issuer')}
              value={draft.idpIssuer}
              onChange={(event) => change({ idpIssuer: event.target.value })}
              error={errors['settings.idpIssuer']}
              required
            />
            <TextAreaField
              label={t('sso.certificate')}
              help={keepsCertificate ? t('sso.kept') : t('sso.certificate_help')}
              value={draft.idpCertificate}
              onChange={(event) => change({ idpCertificate: event.target.value })}
              error={errors['settings.idpCertificate']}
              rows={5}
              required={!keepsCertificate}
            />
          </>
        )}
        <TextAreaField
          label={t('sso.domains')}
          help={t('sso.domains_help')}
          value={draft.domains}
          onChange={(event) => change({ domains: event.target.value })}
          error={
            errors.domains ??
            Object.entries(errors).find(([path]) => path.startsWith('domains.'))?.[1]
          }
          rows={3}
          required
        />
        <Checkbox
          label={t('sso.enabled')}
          detail={t('sso.enabled_help')}
          checked={draft.enabled}
          onChange={(event) => change({ enabled: event.target.checked })}
        />
        <Checkbox
          label={t('sso.enforced')}
          detail={t('sso.enforced_help')}
          checked={draft.enabled && draft.enforced}
          disabled={!draft.enabled}
          onChange={(event) => change({ enforced: event.target.checked })}
        />
        {failure ? (
          <p className="ks-help error" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={busy}>
            {t('sso.save')}
          </Button>
          {done ? (
            <span className="ks-muted" role="status">
              {t('sso.saved')}
            </span>
          ) : null}
        </div>
      </form>
    </Section>
  );
}
