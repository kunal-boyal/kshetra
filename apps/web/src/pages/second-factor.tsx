import { ApiError } from '@thelamp/api-client';
import { RECOVERY_CODE } from '@thelamp/shared';
import { Button, QrCode, TextField } from '@thelamp/ui-web';
import { type FormEvent, useEffect, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';

/** The secret as people type it: groups of four. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

/**
 * The second step of a web sign-in for someone who can change access (spec M1, decision D91):
 * setting up an authenticator the first time, with the recovery codes shown once, and its code,
 * or a recovery code, each time after.
 */
export function SecondFactorStep({
  ticket,
  enrolled,
  organisation,
  onSignedIn,
  onExpired,
}: {
  ticket: string;
  enrolled: boolean;
  organisation: string;
  onSignedIn: () => void;
  /** The sign-in ran out, or too many wrong codes ended it: start again with a new code. */
  onExpired: () => void;
}) {
  const { client } = useApp();
  const { t } = useLanguage();
  const [setup, setSetup] = useState<{ secret: string; uri: string }>();
  const [recovering, setRecovering] = useState(false);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [codes, setCodes] = useState<string[]>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (enrolled) return;
    let gone = false;
    client.totpSetup(ticket).then(
      (result) => {
        if (!gone) setSetup(result);
      },
      (caught: unknown) => {
        if (caught instanceof ApiError && caught.code === 'OTP_EXPIRED') onExpired();
        else if (!gone) setError(errorMessage(caught, t));
      },
    );
    return () => {
      gone = true;
    };
  }, [client, enrolled, onExpired, t, ticket]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await client.totpVerify(
        ticket,
        recovering ? { recoveryCode: recovery.trim().toUpperCase() } : { code },
      );
      if (result.recoveryCodes) setCodes(result.recoveryCodes);
      else onSignedIn();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'OTP_EXPIRED') {
        onExpired();
        return;
      }
      setError(errorMessage(caught, t));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function copy(list: string[]) {
    try {
      await navigator.clipboard.writeText(list.join('\n'));
      setCopied(true);
    } catch {
      // Copying is a convenience; the codes stay on screen to write down.
    }
  }

  if (codes) {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="codes-title">
        <h1 id="codes-title" className="heading-xl">
          {t('signin.codes_title')}
        </h1>
        <p className="ks-muted">{t('signin.codes_intro')}</p>
        <ol className="grid grid-cols-2 gap-2" aria-label={t('signin.codes_label')}>
          {codes.map((each) => (
            <li key={each} className="ks-card num text-center">
              {each}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void copy(codes)}>
            {t('signin.copy_codes')}
          </Button>
          {copied ? (
            <span className="ks-muted" role="status">
              {t('signin.copied')}
            </span>
          ) : null}
        </div>
        <Button variant="primary" block onClick={onSignedIn}>
          {t('signin.codes_saved')}
        </Button>
      </section>
    );
  }

  const settingUp = !enrolled;
  return (
    <form className="flex flex-col gap-4" onSubmit={verify} noValidate>
      <h1 className="heading-xl">{t(settingUp ? 'signin.setup_title' : 'signin.totp_title')}</h1>
      <p className="ks-muted">
        {t(settingUp ? 'signin.setup_intro' : 'signin.totp_intro', { organisation })}
      </p>
      {settingUp && setup ? (
        <div className="flex flex-col items-center gap-2">
          <QrCode value={setup.uri} label={t('signin.qr_label')} />
          <p className="ks-muted caption">{t('signin.setup_key')}</p>
          <code className="num break-all text-center" aria-label={t('signin.setup_key')}>
            {grouped(setup.secret)}
          </code>
        </div>
      ) : null}
      {recovering ? (
        <TextField
          label={t('signin.recovery_label')}
          help={t('signin.recovery_help')}
          error={error}
          autoComplete="off"
          value={recovery}
          onChange={(event) => setRecovery(event.target.value)}
          required
          autoFocus
        />
      ) : (
        <TextField
          label={t('signin.totp_label')}
          help={t('signin.totp_help')}
          error={error}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          numeric
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          required
          autoFocus
        />
      )}
      <Button
        type="submit"
        variant="primary"
        block
        busy={busy}
        disabled={
          recovering
            ? !RECOVERY_CODE.test(recovery.trim().toUpperCase())
            : code.length !== 6 || (settingUp && !setup)
        }
      >
        {t(settingUp ? 'signin.confirm' : 'signin.verify')}
      </Button>
      {enrolled ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            setRecovering(!recovering);
            setError(undefined);
          }}
        >
          {t(recovering ? 'signin.use_totp' : 'signin.use_recovery')}
        </Button>
      ) : null}
    </form>
  );
}
