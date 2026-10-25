import { SecondFactorResetResult, type ConsoleTenant } from '@thelamp/shared';
import { Button, Card, Notice, TextAreaField, TextField } from '@thelamp/ui-web';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useConsole } from '../context';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';
import { holds } from './shared';

/**
 * Vendor support removes the authenticator of a tenant's member who lost it and their recovery
 * codes, when no other admin can (decision D91). Found by their number; their sessions end.
 */
export function SecondFactorResetCard({ tenant }: { tenant: ConsoleTenant }) {
  const { client } = useConsole();
  const { t } = useLanguage();
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();
  const [outcome, setOutcome] = useState<boolean>();
  const reset = useMutation({
    mutationFn: (body: { phone: string; reason: string }) =>
      client.request(
        'POST',
        `/platform/v1/tenants/${tenant.id}/second-factor-resets`,
        SecondFactorResetResult,
        body,
      ),
  });
  if (!holds(client.staff, 'platform.support.request')) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFailure(undefined);
    setOutcome(undefined);
    try {
      const result = await reset.mutateAsync({ phone: phone.trim(), reason: reason.trim() });
      setOutcome(result.removed);
      setPhone('');
      setReason('');
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error, t));
    }
  }

  return (
    <Card>
      <form className="flex max-w-xl flex-col gap-4" onSubmit={submit} noValidate>
        <h2 className="heading-md">{t('console.second_factor_reset')}</h2>
        <p className="ks-muted">{t('console.second_factor_intro')}</p>
        <TextField
          label={t('console.member_phone')}
          type="tel"
          autoComplete="off"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          error={errors.phone}
          required
        />
        <TextAreaField
          label={t('console.second_factor_reason')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={errors.reason}
          rows={2}
          required
        />
        {failure && !errors.phone ? (
          <p className="ks-help error" role="alert">
            {failure}
          </p>
        ) : null}
        {outcome !== undefined ? (
          <Notice>
            {t(outcome ? 'console.second_factor_removed' : 'console.second_factor_none')}
          </Notice>
        ) : null}
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          busy={reset.isPending}
          disabled={!phone.trim() || reason.trim().length < 3}
        >
          {t('console.reset')}
        </Button>
      </form>
    </Card>
  );
}
