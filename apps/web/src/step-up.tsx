import type { ApiError } from '@thelamp/api-client';
import { Button, TextField } from '@thelamp/ui-web';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { errorMessage, useLanguage } from './i18n';

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
 * out; cancelling leaves it undone.
 */
export function StepUpPrompt() {
  const { t } = useLanguage();
  const [pending, setPending] = useState<{
    wrong: ApiError | null;
    answer: (code: string | null) => void;
  }>();
  const [code, setCode] = useState('');
  const field = useRef<HTMLDivElement>(null);
  const title = useId();

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
  }, [pending]);

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
      </form>
    </div>
  );
}
