import { ApiError } from '@thelamp/api-client';
import { Button, Icon, SegmentedControl, TextField } from '@thelamp/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { emailMessage, mobileMessage } from '@thelamp/i18n';
import { SSO_FAILURES, type SecondFactor, type SsoFailure } from '@thelamp/shared';
import { useApp } from '../context';
import { EmailField, MobileField } from '../fields';
import { errorMessage, useLanguage } from '../i18n';
import markUrl from '@thelamp/design-tokens/assets/Logos/mark-small.svg?url';
import { PRODUCT_NAME } from '../layout/brand';
import { LanguageToggle } from '../layout/preferences-menu';
import { SecondFactorStep } from './second-factor';
import { browser } from '../browser';

/** How long before a new code may be asked for; the server allows 3 every 10 minutes (M1). */
const RESEND_SECONDS = 30;

type Step =
  | { name: 'phone' }
  | { name: 'code'; phone: string }
  | { name: 'second'; ticket: string; enrolled: boolean; organisation: string }
  | { name: 'sso' };

export { browser } from '../browser';

/** Why a single sign-on came back here, from the `sso` parameter the directory adds. */
function ssoFailure(): SsoFailure | undefined {
  const reason = new URLSearchParams(window.location.search).get('sso');
  return SSO_FAILURES.find((failure) => failure === reason);
}

/**
 * An SSO sign-in that came back for our authenticator code, as the provider asked for none
 * (decision D101): the ticket comes in the fragment, which no server sees, and leaves the address
 * bar at once.
 */
function ssoSecondFactor(): Step | undefined {
  if (new URLSearchParams(window.location.search).get('sso') !== 'second_factor') return undefined;
  const held = new URLSearchParams(window.location.hash.slice(1));
  const ticket = held.get('ticket');
  window.history.replaceState(null, '', window.location.pathname);
  if (!ticket) return undefined;
  return {
    name: 'second',
    ticket,
    enrolled: held.get('enrolled') === '1',
    organisation: held.get('tenant') ?? '',
  };
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
  const [step, setStep] = useState<Step>(
    () => ssoSecondFactor() ?? (failure ? { name: 'sso' } : { name: 'phone' }),
  );
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [checked, setChecked] = useState(false);
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
    // A number that can't be one is explained here, before anything is sent (decision D102).
    if (mobileMessage(phone)) {
      setChecked(true);
      return;
    }
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
      if (result.status === 'second_factor') {
        setStep(secondStep(result));
        return;
      }
      await navigate({ to: '/' });
    });
  }

  function startSso(event: FormEvent) {
    event.preventDefault();
    if (emailMessage(email, true)) {
      setChecked(true);
      return;
    }
    void run(async () => {
      const url = await client.ssoDiscover(email.trim());
      if (url) browser.go(url);
      else setError(t('signin.sso_none'));
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
        <p className="text-sm">{t('signin.used_by')}</p>
        <img className="ks-auth-art" src={markUrl} alt="" aria-hidden="true" />
      </aside>
      <div className="ks-auth-form">
        <div className="ks-enter flex flex-col gap-5">
          {step.name === 'phone' || step.name === 'sso' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h1 className="heading-xl">{t('signin.title')}</h1>
                <p className="ks-meta">{t('signin.subtitle')}</p>
              </div>
              <SegmentedControl
                label={t('signin.method')}
                value={step.name}
                onChange={(method) => {
                  setError(undefined);
                  setStep(method === 'sso' ? { name: 'sso' } : { name: 'phone' });
                }}
                choices={[
                  { value: 'phone', label: t('signin.method_phone') },
                  { value: 'sso', label: t('signin.method_sso') },
                ]}
              />
            </div>
          ) : null}
          <div>
            {step.name === 'phone' ? (
              <form className="flex flex-col gap-4" onSubmit={sendCode} noValidate>
                {spent ? (
                  <p className="ks-help error" role="alert">
                    {t('signin.support_expired')}
                  </p>
                ) : null}
                <p className="ks-muted">{t('signin.intro')}</p>
                <MobileField
                  label={t('signin.phone_label')}
                  help={t('signin.phone_help')}
                  error={error}
                  checked={checked}
                  value={phone}
                  onChange={setPhone}
                  required
                  autoFocus
                />
                <Button type="submit" variant="primary" block busy={busy} disabled={!phone.trim()}>
                  {t('signin.send_code')}
                </Button>
              </form>
            ) : null}

            {step.name === 'sso' ? (
              <form className="flex flex-col gap-4" onSubmit={startSso} noValidate>
                <h2 className="heading-md">{t('signin.sso_title')}</h2>
                <p className="ks-muted">{t('signin.sso_intro')}</p>
                <EmailField
                  label={t('signin.sso_email')}
                  error={error}
                  checked={checked}
                  value={email}
                  onChange={setEmail}
                  required
                  autoFocus
                />
                <Button
                  type="submit"
                  variant="primary"
                  block
                  busy={busy}
                  disabled={!email.trim()}
                  icon={<Icon icon={KeyRound} size="sm" />}
                >
                  {t('signin.sso_continue')}
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
                  className="code"
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
          </div>
          <div className="ks-spread flex-wrap gap-2 text-sm">
            <LanguageToggle className="-ml-3" />
            <span className="ks-muted">{t('signin.two_step_note')}</span>
          </div>
          <p className="ks-subtle caption flex justify-center gap-4">
            <Link to="/privacy">{t('privacy.open')}</Link>
            <Link to="/delete-account">{t('deletion.open')}</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
