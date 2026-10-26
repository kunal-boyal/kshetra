import { AuthenticatorConfirmResult, AuthenticatorStatus, TotpSetupResult } from '@thelamp/shared';
import { Button, Notice, QrCode, StatusBadge, TextField } from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { NOTHING, read, write } from '../people/data';
import { PageHeader, Section } from '../people/shared';

/** The secret as people type it: groups of four. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

/** A six-digit code from the authenticator app. */
function CodeField({
  label,
  help,
  value,
  error,
  onChange,
}: {
  label: string;
  help?: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      label={label}
      {...(help ? { help } : {})}
      error={error}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      numeric
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
      required
    />
  );
}

/**
 * Sign-in security (decision D101): anyone may set up an authenticator app, which the portal then
 * asks for after the SMS code; where their role needs one it stays on. Recovery codes are shown
 * once, as at sign-in.
 */
export function SecurityPage() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const status = useQuery({
    queryKey: ['authenticator'],
    queryFn: () => read(client, '/auth/v1/authenticator', AuthenticatorStatus),
  });
  const [setup, setSetup] = useState<{ secret: string; uri: string }>();
  const [codes, setCodes] = useState<string[]>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    try {
      await work();
    } catch (caught) {
      setError(errorMessage(caught, t));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    act(async () => {
      setSetup(await write(client, 'POST', '/auth/v1/authenticator/setup', TotpSetupResult));
    });

  const confirm = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      const result = await write(
        client,
        'POST',
        '/auth/v1/authenticator/confirm',
        AuthenticatorConfirmResult,
        { code },
      );
      setCodes(result?.recoveryCodes ?? []);
      setSetup(undefined);
      setCode('');
      setDone(t('security.turned_on'));
      await queryClient.invalidateQueries({ queryKey: ['authenticator'] });
    });
  };

  const remove = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await write(client, 'POST', '/auth/v1/authenticator/remove', NOTHING, { code });
      setCode('');
      setDone(t('security.turned_off'));
      await queryClient.invalidateQueries({ queryKey: ['authenticator'] });
    });
  };

  const state = status.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('security.title')} intro={t('security.intro')} />
      <Section title={t('security.authenticator')}>
        {status.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(status.error, t)}
          </p>
        ) : !state ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : (
          <div className="flex max-w-prose flex-col gap-4">
            <p className="flex flex-wrap items-center gap-2">
              <StatusBadge variant={state.enrolled ? 'success' : 'neutral'}>
                {t(state.enrolled ? 'security.status_on' : 'security.status_off')}
              </StatusBadge>
              <span>{t(state.enrolled ? 'security.on' : 'security.off')}</span>
            </p>
            {state.required ? <p className="ks-muted">{t('security.required')}</p> : null}
            {!state.enrolled ? <Notice>{t('security.sms_note')}</Notice> : null}
            {done ? <p role="status">{done}</p> : null}

            {codes ? (
              <section className="flex flex-col gap-3" aria-labelledby="codes-title">
                <h2 id="codes-title" className="heading-md">
                  {t('signin.codes_title')}
                </h2>
                <p className="ks-muted">{t('signin.codes_intro')}</p>
                <ol className="grid grid-cols-2 gap-2" aria-label={t('signin.codes_label')}>
                  {codes.map((each) => (
                    <li key={each} className="ks-card num text-center">
                      {each}
                    </li>
                  ))}
                </ol>
                <Button
                  variant="primary"
                  className="self-start"
                  onClick={() => setCodes(undefined)}
                >
                  {t('signin.codes_saved')}
                </Button>
              </section>
            ) : null}

            {!state.enrolled && !setup && !codes ? (
              <Button
                variant="primary"
                className="self-start"
                busy={busy}
                onClick={() => void start()}
              >
                {t('security.set_up')}
              </Button>
            ) : null}

            {setup ? (
              <form className="flex flex-col gap-4" onSubmit={confirm} noValidate>
                <p>{t('security.scan')}</p>
                <div className="flex flex-col items-center gap-2 self-start">
                  <QrCode value={setup.uri} label={t('signin.qr_label')} />
                  <p className="ks-muted caption">{t('signin.setup_key')}</p>
                  <code className="num break-all text-center" aria-label={t('signin.setup_key')}>
                    {grouped(setup.secret)}
                  </code>
                </div>
                <CodeField
                  label={t('signin.totp_label')}
                  value={code}
                  error={error}
                  onChange={setCode}
                />
                <Button
                  type="submit"
                  variant="primary"
                  className="self-start"
                  busy={busy}
                  disabled={code.length !== 6}
                >
                  {t('security.turn_on')}
                </Button>
              </form>
            ) : null}

            {state.enrolled && !state.required && !codes ? (
              <form className="flex flex-col gap-4" onSubmit={remove} noValidate>
                <h2 className="heading-md">{t('security.turn_off')}</h2>
                <CodeField
                  label={t('signin.totp_label')}
                  help={t('security.turn_off_help')}
                  value={code}
                  error={error}
                  onChange={setCode}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  className="self-start"
                  busy={busy}
                  disabled={code.length !== 6}
                >
                  {t('security.turn_off')}
                </Button>
              </form>
            ) : null}

            {error && !setup && !(state.enrolled && !state.required) ? (
              <p className="ks-help error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </Section>
    </div>
  );
}
