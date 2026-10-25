import { Link } from '@tanstack/react-router';
import { ApiError } from '@thelamp/api-client';
import { Button, Card, Notice, QrCode, TextField } from '@thelamp/ui-web';
import { type FormEvent, useState } from 'react';
import { markUrl, PRODUCT_NAME } from '../brand';
import { useConsole } from '../context';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';

type Step =
  { name: 'password' } | { name: 'authenticator'; secret: string; uri: string } | { name: 'done' };

/** The secret in groups of four, as people read it into an authenticator. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

/**
 * Setting up from an invitation (decision D88): a password, then an authenticator app with the
 * secret shown here once, confirmed by its first code. The invitation's secret is in the link's
 * fragment, which browsers never send to a server.
 */
export function SetupPage() {
  const { client } = useConsole();
  const { t } = useLanguage();
  const [token] = useState(() => window.location.hash.slice(1));
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const explain = (error: unknown) => {
    setErrors(fieldErrors(error));
    setFailure(
      error instanceof ApiError && error.code === 'UNAUTHENTICATED'
        ? t('console.setup_expired')
        : errorMessage(error, t),
    );
  };

  async function choosePassword(event: FormEvent) {
    event.preventDefault();
    if (password !== again) {
      setErrors({ again: t('console.password_mismatch') });
      return;
    }
    setBusy(true);
    setFailure(undefined);
    setErrors({});
    try {
      const { secret, uri } = await client.setUp(token, password);
      setStep({ name: 'authenticator', secret, uri });
    } catch (error) {
      explain(error);
    }
    setBusy(false);
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    setErrors({});
    try {
      await client.confirm(token, code);
      setStep({ name: 'done' });
    } catch (error) {
      explain(error);
      setCode('');
    }
    setBusy(false);
  }

  return (
    <main className="ks ks-auth">
      <aside className="ks-auth-brand" aria-label={PRODUCT_NAME}>
        <span className="ks-auth-name">
          {PRODUCT_NAME} {t('console.label')}
        </span>
        <img className="ks-auth-art" src={markUrl} alt="" aria-hidden="true" />
      </aside>
      <div className="ks-auth-form">
        <Card className="ks-enter">
          {!token ? (
            <div className="flex flex-col gap-4">
              <h1 className="heading-xl">{t('console.setup_title')}</h1>
              <p role="alert">{t('console.setup_expired')}</p>
            </div>
          ) : step.name === 'password' ? (
            <form className="flex flex-col gap-4" onSubmit={choosePassword} noValidate>
              <h1 className="heading-xl">{t('console.setup_title')}</h1>
              <p className="ks-muted">{t('console.setup_intro')}</p>
              <TextField
                label={t('console.new_password')}
                help={t('console.password_help')}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={errors.password}
                required
              />
              <TextField
                label={t('console.password_again')}
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(event) => setAgain(event.target.value)}
                error={errors.again}
                required
              />
              {failure ? (
                <p className="ks-help error" role="alert">
                  {failure}
                </p>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                block
                busy={busy}
                disabled={password.length < 12 || !again}
              >
                {t('console.continue')}
              </Button>
            </form>
          ) : step.name === 'authenticator' ? (
            <form className="flex flex-col gap-4" onSubmit={confirm} noValidate>
              <h1 className="heading-xl">{t('console.authenticator_title')}</h1>
              <p className="ks-muted">{t('console.authenticator_intro')}</p>
              <QrCode value={step.uri} label={t('console.qr_label')} />
              <p
                className="font-mono text-lg font-semibold tracking-wide break-all"
                aria-label={t('console.secret')}
              >
                {grouped(step.secret)}
              </p>
              <a className="ks-btn secondary self-start" href={step.uri}>
                {t('console.open_authenticator')}
              </a>
              <Notice>{t('console.secret_once')}</Notice>
              <TextField
                label={t('console.code')}
                help={t('console.code_help')}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                error={errors.code}
                required
              />
              {failure ? (
                <p className="ks-help error" role="alert">
                  {failure}
                </p>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                block
                busy={busy}
                disabled={code.length !== 6}
              >
                {t('console.finish_setup')}
              </Button>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <h1 className="heading-xl">{t('console.setup_done_title')}</h1>
              <p>{t('console.setup_done')}</p>
              <Link to="/sign-in" className="ks-btn primary">
                {t('console.signin')}
              </Link>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
