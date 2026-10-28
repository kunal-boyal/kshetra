import { emailMessage } from '@thelamp/i18n';
import { useNavigate } from '@tanstack/react-router';
import { ApiError } from '@thelamp/api-client';
import { Button, Card, TextField } from '@thelamp/ui-web';
import { type FormEvent, useState } from 'react';
import { markUrl, PRODUCT_NAME } from '../brand';
import { useConsole } from '../context';
import { EmailField } from '../fields';
import { errorMessage, useLanguage } from '../i18n';

/** Vendor staff sign in with email, password and a code from their authenticator (decision D88). */
export function SignInPage() {
  const { client } = useConsole();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    // A number or address that can't be one is explained here, before anything is sent (D102).
    if (emailMessage(email, true)) {
      setChecked(true);
      return;
    }
    setBusy(true);
    setFailure(undefined);
    try {
      await client.signIn(email.trim(), password, code.trim());
      await navigate({ to: '/' });
    } catch (error) {
      setFailure(
        error instanceof ApiError && error.code === 'UNAUTHENTICATED'
          ? t('console.signin_failed')
          : errorMessage(error, t),
      );
      setCode('');
      setBusy(false);
    }
  }

  return (
    <main className="ks ks-auth">
      {/* The portal's brand panel (D104): the mark and name, the line, who uses it, the art. */}
      <aside className="ks-auth-brand" aria-label={PRODUCT_NAME}>
        <span className="ks-auth-name">
          <img src={markUrl} alt="" width={40} height={40} />
          {PRODUCT_NAME} {t('console.label')}
        </span>
        <div className="flex flex-col gap-3">
          <p className="ks-auth-tagline">{t('signin.tagline')}</p>
          <p>{t('console.tagline')}</p>
        </div>
        <p className="text-sm">{t('signin.used_by')}</p>
        <img className="ks-auth-art" src={markUrl} alt="" aria-hidden="true" />
      </aside>
      <div className="ks-auth-form">
        <Card className="ks-enter">
          <form className="flex flex-col gap-4" onSubmit={signIn} noValidate>
            <h1 className="heading-xl">{t('console.signin_title')}</h1>
            <p className="ks-muted">{t('console.signin_intro')}</p>
            <EmailField
              label={t('console.email')}
              help={t('console.email_help')}
              autoComplete="username"
              checked={checked}
              value={email}
              onChange={setEmail}
              required
              reserveNote
            />
            <TextField
              label={t('console.password')}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <TextField
              label={t('console.code')}
              help={t('console.code_help')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              required
            />
            <Button
              type="submit"
              variant="primary"
              block
              busy={busy}
              disabled={!email.trim() || !password || code.length !== 6}
            >
              {t('console.signin')}
            </Button>
            {/* Under the button, in a line kept for it, so a failure moves no field (D104). */}
            <p className={failure ? 'ks-help error reserve' : 'ks-help reserve'} role="alert">
              {failure}
            </p>
          </form>
        </Card>
      </div>
    </main>
  );
}
