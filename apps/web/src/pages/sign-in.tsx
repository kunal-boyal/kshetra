import { ApiError } from '@kshetra/api-client';
import { Button, Card, Icon, TextField } from '@kshetra/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Building2, ChevronRight } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { Brand } from '../layout/brand';
import { LanguagePicker } from '../layout/preferences-menu';
import { saveTenants } from '../preferences';

/** How long before a new code may be asked for; the server allows 3 every 10 minutes (M1). */
const RESEND_SECONDS = 30;

type Step =
  | { name: 'phone' }
  | { name: 'code'; phone: string }
  | { name: 'choose'; ticket: string; tenants: { id: string; name: string }[] };

/** Signing in with a mobile number and a one-time code (spec 8.1, module M1). */
export function SignInPage() {
  const { client } = useApp();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>({ name: 'phone' });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

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
      await navigate({ to: '/' });
    });
  }

  function choose(ticket: string, tenantId: string) {
    void run(async () => {
      await client.selectTenant(ticket, tenantId);
      await navigate({ to: '/' });
    });
  }

  return (
    <main className="ks mx-auto flex min-h-screen max-w-[440px] flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <Brand />
        <LanguagePicker />
      </div>
      <Card className="ks-enter">
        {step.name === 'phone' ? (
          <form className="flex flex-col gap-4" onSubmit={sendCode} noValidate>
            <h1 className="heading-xl">{t('signin.title')}</h1>
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
            <Button type="submit" variant="primary" block busy={busy} disabled={code.length !== 6}>
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
    </main>
  );
}
