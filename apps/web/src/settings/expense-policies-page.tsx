import {
  EXPENSE_CALCULATIONS,
  EXPENSE_CATEGORIES,
  type ExpenseCalculation,
  type ExpensePolicyResult,
  ExpensePolicyListResult,
  todayIn,
} from '@thelamp/shared';
import { Button, Checkbox, Icon, Notice, SelectField, TextField } from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { fieldErrors, PageHeader } from '../people/shared';

type Category = (typeof EXPENSE_CATEGORIES)[number];

interface PolicyDraft {
  key: string;
  nameEn: string;
  nameHi: string;
  category: Category;
  calculation: ExpenseCalculation;
  rateKind: 'flat' | 'by';
  flat: string;
  byDesignation: Record<string, string>;
  perClaim: string;
  perDay: string;
  perMonth: string;
  receiptRequired: boolean;
  odometerPhotosRequired: boolean;
  active: boolean;
}

const MAX_POLICIES = 30;

function draftOf(policy: ExpensePolicyResult): PolicyDraft {
  const rate = policy.rate;
  return {
    key: policy.key,
    nameEn: policy.name.en,
    nameHi: policy.name.hi,
    category: policy.category,
    calculation: policy.calculation,
    rateKind: rate && 'byDesignation' in rate ? 'by' : 'flat',
    flat: rate && 'flat' in rate ? rate.flat : '',
    byDesignation: rate && 'byDesignation' in rate ? { ...rate.byDesignation } : {},
    perClaim: policy.caps.perClaim ?? '',
    perDay: policy.caps.perDay ?? '',
    perMonth: policy.caps.perMonth ?? '',
    receiptRequired: policy.receiptRequired,
    odometerPhotosRequired: policy.odometerPhotosRequired,
    active: policy.active,
  };
}

const EMPTY: PolicyDraft = {
  key: '',
  nameEn: '',
  nameHi: '',
  category: 'travel',
  calculation: 'per_km',
  rateKind: 'flat',
  flat: '',
  byDesignation: {},
  perClaim: '',
  perDay: '',
  perMonth: '',
  receiptRequired: false,
  odometerPhotosRequired: false,
  active: true,
};

/** A draft as the API takes it: only the rate and caps it has. */
function bodyOf(draft: PolicyDraft) {
  const rates = Object.entries(draft.byDesignation).filter(([, amount]) => amount.trim());
  const caps = Object.fromEntries(
    (
      [
        ['perClaim', draft.perClaim],
        ['perDay', draft.perDay],
        ['perMonth', draft.perMonth],
      ] as const
    ).flatMap(([cap, amount]) => (amount.trim() ? [[cap, amount.trim()]] : [])),
  );
  return {
    key: draft.key.trim(),
    name: { en: draft.nameEn.trim(), hi: draft.nameHi.trim() || draft.nameEn.trim() },
    category: draft.category,
    calculation: draft.calculation,
    ...(draft.calculation === 'actual'
      ? {}
      : draft.rateKind === 'flat'
        ? { rate: { flat: draft.flat.trim() } }
        : {
            rate: {
              byDesignation: Object.fromEntries(rates.map(([key, amount]) => [key, amount.trim()])),
            },
          }),
    caps,
    receiptRequired: draft.receiptRequired,
    odometerPhotosRequired: draft.calculation === 'per_km' && draft.odometerPhotosRequired,
    active: draft.active,
  };
}

/**
 * Expense policies (M12, spec 5.10, decision D82): how each claim is paid, at a flat rate or by
 * designation, within caps, with the proof it needs. A change applies to claims from a chosen day;
 * a policy keeps its key once saved and is switched off rather than removed.
 */
export function ExpensePoliciesPage() {
  const { client } = useApp();
  const { t } = useLanguage();
  const policies = useQuery({
    queryKey: ['expense-policies'],
    queryFn: () => read(client, '/v1/expense-policies', ExpensePolicyListResult),
  });
  if (policies.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(policies.error, t)}
      </p>
    );
  }
  if (!policies.data) return <p className="ks-muted">{t('common.loading')}</p>;
  return <Editor policies={policies.data.items} />;
}

function Editor({ policies }: { policies: readonly ExpensePolicyResult[] }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState(() => policies.map(draftOf));
  // Saved policies lead the list; those after them are new until saved.
  const [savedCount, setSavedCount] = useState(policies.length);
  const [from, setFrom] = useState(() => todayIn(access.timezone));
  const [failure, setFailure] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const change = (index: number, patch: Partial<PolicyDraft>) =>
    setDrafts(drafts.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    setSaved(false);
    try {
      const result = await write(client, 'PUT', '/v1/expense-policies', ExpensePolicyListResult, {
        items: drafts.map(bodyOf),
        from,
      });
      if (result) {
        setDrafts(result.items.map(draftOf));
        setSavedCount(result.items.length);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['expense-policies'] }),
        queryClient.invalidateQueries({ queryKey: ['config'] }),
      ]);
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const at = (index: number, field: string) => {
    const issue = errors[`items[${index}].${field}`];
    return issue ? { error: issue } : {};
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('policies.title')} intro={t('policies.intro')} />
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        {saved ? <Notice>{t('common.saved')}</Notice> : null}
        {failure !== undefined ? (
          <div className="ks-help error" role="alert">
            <p>{errorMessage(failure, t)}</p>
            <ul>
              {Object.entries(errors).map(([path, issue]) => (
                <li key={path}>
                  <code>{path}</code>: {issue}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <ol className="flex flex-col gap-4" aria-label={t('policies.title')}>
          {drafts.map((draft, index) => {
            const isNew = index >= savedCount;
            return (
              <li key={index} className="ks-card flex flex-col gap-3">
                <h2 className="heading-sm">
                  {t('policies.policy_n', { number: String(index + 1) })}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    label={t('policies.key')}
                    help={isNew ? t('policies.key_help') : t('policies.key_kept')}
                    required
                    readOnly={!isNew}
                    value={draft.key}
                    {...at(index, 'key')}
                    onChange={(event) => change(index, { key: event.target.value })}
                  />
                  <SelectField
                    label={t('policies.category')}
                    value={draft.category}
                    options={EXPENSE_CATEGORIES.map((category) => ({
                      value: category,
                      label: t(`policies.category_${category}`),
                    }))}
                    onChange={(event) =>
                      change(index, { category: event.target.value as Category })
                    }
                  />
                  <TextField
                    label={t('policies.name_en')}
                    required
                    value={draft.nameEn}
                    {...at(index, 'name.en')}
                    onChange={(event) => change(index, { nameEn: event.target.value })}
                  />
                  <TextField
                    label={t('policies.name_hi')}
                    value={draft.nameHi}
                    {...at(index, 'name.hi')}
                    onChange={(event) => change(index, { nameHi: event.target.value })}
                  />
                  <SelectField
                    label={t('policies.calculation')}
                    value={draft.calculation}
                    options={EXPENSE_CALCULATIONS.map((calculation) => ({
                      value: calculation,
                      label: t(`policies.calc_${calculation}`),
                    }))}
                    onChange={(event) =>
                      change(index, { calculation: event.target.value as ExpenseCalculation })
                    }
                  />
                  {draft.calculation === 'actual' ? (
                    <span />
                  ) : (
                    <SelectField
                      label={t('policies.rate_kind')}
                      value={draft.rateKind}
                      options={[
                        { value: 'flat', label: t('policies.rate_flat') },
                        { value: 'by', label: t('policies.rate_by') },
                      ]}
                      onChange={(event) =>
                        change(index, { rateKind: event.target.value as PolicyDraft['rateKind'] })
                      }
                    />
                  )}
                  {draft.calculation !== 'actual' && draft.rateKind === 'flat' ? (
                    <TextField
                      label={t('policies.rate')}
                      inputMode="decimal"
                      required
                      value={draft.flat}
                      {...at(index, 'rate.flat')}
                      onChange={(event) => change(index, { flat: event.target.value })}
                    />
                  ) : null}
                  {draft.calculation !== 'actual' && draft.rateKind === 'by'
                    ? access.designations.map((designation) => (
                        <TextField
                          key={designation.key}
                          label={t('policies.rate_for', {
                            designation: designation.name[locale].one,
                          })}
                          help={t('policies.rate_for_help')}
                          inputMode="decimal"
                          value={draft.byDesignation[designation.key] ?? ''}
                          {...at(index, `rate.byDesignation.${designation.key}`)}
                          onChange={(event) =>
                            change(index, {
                              byDesignation: {
                                ...draft.byDesignation,
                                [designation.key]: event.target.value,
                              },
                            })
                          }
                        />
                      ))
                    : null}
                  <TextField
                    label={t('policies.cap_claim')}
                    help={t('policies.cap_help')}
                    inputMode="decimal"
                    value={draft.perClaim}
                    {...at(index, 'caps.perClaim')}
                    onChange={(event) => change(index, { perClaim: event.target.value })}
                  />
                  <TextField
                    label={t('policies.cap_day')}
                    help={t('policies.cap_help')}
                    inputMode="decimal"
                    value={draft.perDay}
                    {...at(index, 'caps.perDay')}
                    onChange={(event) => change(index, { perDay: event.target.value })}
                  />
                  <TextField
                    label={t('policies.cap_month')}
                    help={t('policies.cap_help')}
                    inputMode="decimal"
                    value={draft.perMonth}
                    {...at(index, 'caps.perMonth')}
                    onChange={(event) => change(index, { perMonth: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Checkbox
                    label={t('policies.receipt')}
                    detail={t('policies.receipt_help')}
                    checked={draft.receiptRequired}
                    onChange={(event) => change(index, { receiptRequired: event.target.checked })}
                  />
                  {draft.calculation === 'per_km' ? (
                    <Checkbox
                      label={t('policies.odometer')}
                      detail={t('policies.odometer_help')}
                      checked={draft.odometerPhotosRequired}
                      onChange={(event) =>
                        change(index, { odometerPhotosRequired: event.target.checked })
                      }
                    />
                  ) : null}
                  <Checkbox
                    label={t('policies.active')}
                    detail={t('policies.active_help')}
                    checked={draft.active}
                    onChange={(event) => change(index, { active: event.target.checked })}
                  />
                </div>
                {isNew ? (
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Icon icon={Trash2} size="sm" />}
                      onClick={() => setDrafts(drafts.filter((_, other) => other !== index))}
                    >
                      {t('common.remove')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="max-w-xs">
          <TextField
            label={t('policies.from')}
            help={t('policies.from_help')}
            type="date"
            value={from}
            {...(errors['from'] ? { error: errors['from'] } : {})}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {drafts.length < MAX_POLICIES ? (
            <Button icon={<Icon icon={Plus} />} onClick={() => setDrafts([...drafts, EMPTY])}>
              {t('policies.add')}
            </Button>
          ) : null}
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
            {t('policies.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
