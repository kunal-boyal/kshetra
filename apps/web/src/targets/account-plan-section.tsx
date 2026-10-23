import { formatNumber } from '@thelamp/i18n';
import { AccountPlanResult, targetValueIssue, todayIn } from '@thelamp/shared';
import { Button, Icon, TextField } from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { fieldErrors, Section, useDates } from '../people/shared';
import { read, useAccess, write } from '../people/data';

/**
 * An account's plan for a month (M8): planned values per targetable metric, a reference for the
 * team that never changes anyone's targets. Those who manage account plans edit it here.
 */
export function AccountPlanSection({ accountId }: { accountId: string }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const plan = useQuery({
    queryKey: ['account-plan', accountId, period],
    queryFn: () =>
      read(client, `/v1/account-plans?accountId=${accountId}&period=${period}`, AccountPlanResult),
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const manages = access.can('account_plan.manage');
  const metrics = plan.data?.metrics ?? [];
  const errors = fieldErrors(failure);
  const issueOf = (key: string, value: string) => {
    const unit = metrics.find((metric) => metric.key === key)?.unit;
    return value.trim() && unit ? targetValueIssue(unit, value) : null;
  };
  const invalid = Object.entries(edits).some(([key, value]) => issueOf(key, value));

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setFailure(undefined);
    try {
      const result = await write(client, 'PUT', '/v1/account-plans', AccountPlanResult, {
        accountId,
        period,
        values: Object.fromEntries(
          Object.entries(edits).map(([key, value]) => [key, value.trim() ? value.trim() : null]),
        ),
      });
      queryClient.setQueryData(['account-plan', accountId, period], result);
      setEdits({});
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('account_plan.title')}>
      <TextField
        label={t('plan.month')}
        type="month"
        className="max-w-xs"
        value={period}
        onChange={(event) => {
          if (!event.target.value) return;
          setPeriod(event.target.value);
          setEdits({});
          setSaved(false);
        }}
      />
      {plan.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(plan.error, t)}
        </p>
      ) : !plan.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : metrics.length === 0 ? (
        <p className="ks-muted">{t('targets.no_metrics_body')}</p>
      ) : manages ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map((metric) => {
              const value = edits[metric.key] ?? plan.data.values[metric.key] ?? '';
              const issue =
                issueOf(metric.key, value) ?? errors[`values.${metric.key}`] ?? undefined;
              return (
                <TextField
                  key={metric.key}
                  label={metric.name[locale].other}
                  inputMode="decimal"
                  numeric
                  value={value}
                  {...(issue ? { error: issue } : {})}
                  onChange={(event) =>
                    setEdits((current) => ({ ...current, [metric.key]: event.target.value }))
                  }
                />
              );
            })}
          </div>
          {failure && Object.keys(errors).length === 0 ? (
            <p className="ks-help error" role="alert">
              {errorMessage(failure, t)}
            </p>
          ) : null}
          {saved ? <p role="status">{t('account_plan.saved')}</p> : null}
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            icon={<Icon icon={Save} />}
            busy={busy}
            disabled={Object.keys(edits).length === 0 || invalid}
          >
            {t('account_plan.save')}
          </Button>
        </form>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
          {metrics.map((metric) => (
            <div key={metric.key} className="contents">
              <dt className="ks-muted">{metric.name[locale].other}</dt>
              <dd>
                {plan.data.values[metric.key] === undefined
                  ? '—'
                  : formatNumber(Number(plan.data.values[metric.key]), { locale })}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {plan.data?.updatedAt ? (
        <p className="ks-muted">
          {t('account_plan.updated', {
            name: plan.data.updatedBy?.name ?? '',
            when: dates.dateTime(plan.data.updatedAt),
          })}
        </p>
      ) : null}
    </Section>
  );
}
