import { type ApiError, noAuthenticator } from '@thelamp/api-client';
import { AuthenticatorStatus } from '@thelamp/shared';
import { Button, TextField } from '@thelamp/ui-web';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useApp } from './context';
import { errorMessage, useLanguage } from './i18n';
import { read } from './people/data';

type Asker = (wrong: ApiError | null) => Promise<string | null>;

let asker: Asker | null = null;

/**
 * The API client's way to ask for a fresh authenticator code (step-up, decision D101): through
 * the prompt on screen, or declining when there is none, so the change fails as it would have.
 */
export function askForStepUp(wrong: ApiError | null): Promise<string | null> {
  return asker ? asker(wrong) : Promise.resolve(null);
}

/**
 * Asks for a fresh code from the person's authenticator when a change needs one: a phone or
 * email, someone's authenticator, single sign-on. The change goes ahead once the code checks
 * out; cancelling leaves it undone. Someone with no authenticator is sent to set one up at
 * Sign-in security first, rather than asked for a code they can't have.
 */
export function StepUpPrompt() {
  const { client } = useApp();
  const { t } = useLanguage();
  const [pending, setPending] = useState<{
    wrong: ApiError | null;
    answer: (code: string | null) => void;
  }>();
  const [code, setCode] = useState('');
  const field = useRef<HTMLDivElement>(null);
  const title = useId();
  const status = useQuery({
    queryKey: ['authenticator'],
    queryFn: () => read(client, '/auth/v1/authenticator', AuthenticatorStatus),
    enabled: pending !== undefined,
  });
  const unset = noAuthenticator(pending?.wrong) || status.data?.enrolled === false;

  useEffect(() => {
    asker = (wrong) =>
      new Promise((answer) => {
        setCode('');
        setPending({ wrong, answer });
      });
    return () => {
      asker = null;
    };
  }, []);

  useEffect(() => {
    if (pending) {
      field.current?.scrollIntoView?.({ block: 'nearest' });
      field.current?.querySelector('input')?.focus();
    }
  }, [pending, unset]);

  if (!pending) return null;
  const answer = (value: string | null) => {
    setPending(undefined);
    pending.answer(value);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    answer(code);
  };
  return (
    <div className="mx-auto w-full max-w-[var(--content-max)] px-6 pt-6">
      <form
        className="ks-card flex max-w-xl flex-col gap-4"
        role="dialog"
        aria-labelledby={title}
        onSubmit={submit}
        noValidate
      >
        <h2 id={title} className="heading-md">
          {t('stepup.title')}
        </h2>
        {unset ? (
          <>
            <p role="alert">{t('stepup.no_authenticator')}</p>
            <div className="flex flex-wrap gap-2">
              <Link to="/security" className="ks-btn primary" onClick={() => answer(null)}>
                {t('stepup.set_up')}
              </Link>
              <Button onClick={() => answer(null)}>{t('common.cancel')}</Button>
            </div>
          </>
        ) : (
          <>
            <p className="ks-muted">{t('stepup.intro')}</p>
            <div ref={field}>
              <TextField
                label={t('signin.totp_label')}
                error={pending.wrong ? errorMessage(pending.wrong, t) : undefined}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                numeric
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                required
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" disabled={code.length !== 6}>
                {t('stepup.continue')}
              </Button>
              <Button onClick={() => answer(null)}>{t('common.cancel')}</Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
