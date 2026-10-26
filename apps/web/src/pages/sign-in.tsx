import { ApiError } from '@thelamp/api-client';
import { Button, Card, Icon, TextField } from '@thelamp/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Building2, ChevronRight, KeyRound } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { SSO_FAILURES, type SecondFactor, type SsoFailure } from '@thelamp/shared';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import markUrl from '@thelamp/design-tokens/assets/Logos/mark-small.svg?url';
import { PRODUCT_NAME } from '../layout/brand';
import { LanguagePicker } from '../layout/preferences-menu';
import { saveTenants } from '../preferences';
import { SecondFactorStep } from './second-factor';
import { browser } from '../browser';

/** How long before a new code may be asked for; the server allows 3 every 10 minutes (M1). */
const RESEND_SECONDS = 30;

type Step =
  | { name: 'phone' }
  | { name: 'code'; phone: string }
  | { name: 'choose'; ticket: string; tenants: { id: string; name: string }[] }
  | { name: 'second'; ticket: string; enrolled: boolean; organisation: string }
  | { name: 'sso' };

export { browser } from '../browser';

/** Why a single sign-on came back here, from the `sso` parameter the directory adds. */
function ssoFailure(): SsoFailure | undefined {
  const reason = new URLSearchParams(window.location.search).get('sso');
  return SSO_FAILURES.find((failure) => failure === reason);
}

/** Whether a vendor support link came back here spent or expired (decision D93). */
function supportLinkSpent(): boolean {
  return new URLSearchParams(window.location.search).get('support') === 'expired';
}

/** The authenticator step a sign-in by someone who can change access goes to (decision D91). */
function secondStep(result: SecondFactor): Step {
  return {
    name: 'second',
    ticket: result.ticket,
    enrolled: result.enrolled,
    organisation: result.tenant.name,
  };
}

/**
 * Signing in with a mobile number and a one-time code (spec 8.1, module M1), then an
 * authenticator code for those who can change access; or with the organisation's own identity
 * provider, found from a work email (decision D91).
 */
export function SignInPage() {
  const { client } = useApp();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [failure] = useState(ssoFailure);
  const [step, setStep] = useState<Step>(failure ? { name: 'sso' } : { name: 'phone' });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>(
    failure ? t(`signin.sso_failed_${failure}`) : undefined,
  );
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [spent] = useState(supportLinkSpent);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (caught) {
      // A tenant that requires single sign-on sends its people there (decision D91).
      if (caught instanceof ApiError && caught.code === 'SSO_REQUIRED') setStep({ name: 'sso' });
      setError(
        caught instanceof ApiError && caught.code === 'VALIDATION'
          ? t('signin.phone_invalid')
          : errorMessage(caught, t),
      );
    } finally {
      setBusy(false);
    }
  }

  function sendCode(event?: FormEvent) {
    event?.preventDefault();
    void run(async () => {
      await client.requestCode(phone);
      setCode('');
      setWait(RESEND_SECONDS);
      setStep({ name: 'code', phone });
    });
  }

  function verify(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await client.verifyCode(phone, code);
      if (result.status === 'choose_tenant') {
        saveTenants(result.tenants);
        setStep({ name: 'choose', ticket: result.ticket, tenants: result.tenants });
        return;
      }
      saveTenants([]);
      if (result.status === 'second_factor') {
        setStep(secondStep(result));
        return;
      }
      await navigate({ to: '/' });
    });
  }

  function startSso(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const url = await client.ssoDiscover(email.trim());
      if (url) browser.go(url);
      else setError(t('signin.sso_none'));
    });
  }

  function choose(ticket: string, tenantId: string) {
    void run(async () => {
      const result = await client.selectTenant(ticket, tenantId);
      if (result.status === 'second_factor') {
        setStep(secondStep(result));
        return;
      }
      await navigate({ to: '/' });
    });
  }

  const signedIn = useCallback(() => void navigate({ to: '/' }), [navigate]);
  const expired = useCallback(() => {
    setStep({ name: 'phone' });
    setError(t('error.OTP_EXPIRED'));
  }, [t]);

  return (
    <main className="ks ks-auth">
      <aside className="ks-auth-brand" aria-label={PRODUCT_NAME}>
        <span className="ks-auth-name">
          <img src={markUrl} alt="" width={40} height={40} />
          {PRODUCT_NAME}
        </span>
        <div className="flex flex-col gap-3">
          <p className="ks-auth-tagline">{t('signin.tagline')}</p>
          <p>{t('signin.tagline_body')}</p>
        </div>
        <img className="ks-auth-art" src={markUrl} alt="" aria-hidden="true" />
      </aside>
      <div className="ks-auth-form">
        <div className="flex flex-col gap-6">
          <div className="flex justify-end">
            <LanguagePicker />
          </div>
          <Card className="ks-enter">
            {step.name === 'phone' ? (
              <form className="flex flex-col gap-4" onSubmit={sendCode} noValidate>
                <h1 className="heading-xl">{t('signin.title')}</h1>
                {spent ? (
                  <p className="ks-help error" role="alert">
                    {t('signin.support_expired')}
                  </p>
                ) : null}
                <p className="ks-muted">{t('signin.intro')}</p>
                <TextField
                  label={t('signin.phone_label')}
                  help={t('signin.phone_help')}
                  error={error}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  required
                  autoFocus
                />
                <Button type="submit" variant="primary" block busy={busy} disabled={!phone.trim()}>
                  {t('signin.send_code')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center"
                  icon={<Icon icon={KeyRound} size="sm" />}
                  onClick={() => {
                    setError(undefined);
                    setStep({ name: 'sso' });
                  }}
                >
                  {t('signin.sso_link')}
                </Button>
              </form>
            ) : null}

            {step.name === 'sso' ? (
              <form className="flex flex-col gap-4" onSubmit={startSso} noValidate>
                <h1 className="heading-xl">{t('signin.sso_title')}</h1>
                <p className="ks-muted">{t('signin.sso_intro')}</p>
                <TextField
                  label={t('signin.sso_email')}
                  error={error}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
                />
                <Button
                  type="submit"
                  variant="primary"
                  block
                  busy={busy}
                  disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
                >
                  {t('signin.sso_continue')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center"
                  onClick={() => {
                    setError(undefined);
                    setStep({ name: 'phone' });
                  }}
                >
                  {t('signin.sso_back')}
                </Button>
              </form>
            ) : null}

            {step.name === 'code' ? (
              <form className="flex flex-col gap-4" onSubmit={verify} noValidate>
                <h1 className="heading-xl">{t('signin.title')}</h1>
                <TextField
                  label={t('signin.code_label')}
                  help={t('signin.code_help', { phone: step.phone })}
                  error={error}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  numeric
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                />
                <Button
                  type="submit"
                  variant="primary"
                  block
                  busy={busy}
                  disabled={code.length !== 6}
                >
                  {t('signin.verify')}
                </Button>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep({ name: 'phone' })}>
                    {t('signin.other_number')}
                  </Button>
                  {wait > 0 ? (
                    <span className="ks-subtle caption" aria-live="polite">
                      {t('signin.resend_in', { count: wait })}
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => sendCode()} disabled={busy}>
                      {t('signin.resend')}
                    </Button>
                  )}
                </div>
              </form>
            ) : null}

            {step.name === 'second' ? (
              <SecondFactorStep
                ticket={step.ticket}
                enrolled={step.enrolled}
                organisation={step.organisation}
                onSignedIn={signedIn}
                onExpired={expired}
              />
            ) : null}

            {step.name === 'choose' ? (
              <section className="flex flex-col gap-4" aria-labelledby="choose-title">
                <h1 id="choose-title" className="heading-xl">
                  {t('signin.choose_title')}
                </h1>
                <p className="ks-muted">{t('signin.choose_intro')}</p>
                {error ? (
                  <p className="ks-help error" role="alert">
                    {error}
                  </p>
                ) : null}
                <ul className="flex flex-col gap-2">
                  {step.tenants.map((tenant) => (
                    <li key={tenant.id}>
                      <Button
                        variant="secondary"
                        block
                        disabled={busy}
                        onClick={() => choose(step.ticket, tenant.id)}
                        icon={<Icon icon={Building2} />}
                      >
                        <span className="flex-1 text-left">{tenant.name}</span>
                        <Icon icon={ChevronRight} size="sm" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </Card>
        </div>
      </div>
    </main>
  );
}
