import { Button, Card, TextField } from '@thelamp/ui-web';
import { type FormEvent, useState } from 'react';
import { useConsoleMutations } from '../data';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';

/**
 * The signed-in staff member's own account (decision D101): changing the password, given the
 * current one and a fresh authenticator code. Every other session ends; this one goes on.
 */
export function AccountPage() {
  const { t } = useLanguage();
  const { changePassword } = useConsoleMutations();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();
  const [done, setDone] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    setFailure(undefined);
    if (newPassword !== again) {
      setErrors({ again: t('console.password_mismatch') });
      return;
    }
    setErrors({});
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword, code });
      setDone(true);
      setCurrentPassword('');
      setNewPassword('');
      setAgain('');
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error, t));
    }
    setCode('');
  }

  return (
    <>
      <h1 className="heading-xl">{t('console.account')}</h1>
      <Card>
        <form className="flex max-w-xl flex-col gap-4" onSubmit={send} noValidate>
          <h2 className="heading-md">{t('console.change_password_title')}</h2>
          <p className="ks-muted">{t('console.change_password_note')}</p>
          <TextField
            label={t('console.current_password')}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            error={errors.currentPassword}
            required
          />
          <TextField
            label={t('console.new_password')}
            help={t('console.new_password_help')}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            error={errors.newPassword}
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
          <TextField
            label={t('console.code')}
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
          {done ? (
            <p className="ks-muted" role="status">
              {t('console.password_changed')}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            busy={changePassword.isPending}
            disabled={!currentPassword || newPassword.length < 12 || !again || code.length !== 6}
          >
            {t('console.change_password')}
          </Button>
        </form>
      </Card>
    </>
  );
}
