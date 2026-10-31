import { type LeaveType, LeaveTypeListResult } from '@thelamp/shared';
import { Button, Checkbox, Icon, Notice, SelectField, TextField } from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, write } from '../people/data';
import { fieldErrors, PageHeader } from '../people/shared';

interface TypeDraft {
  key: string;
  nameEn: string;
  nameHi: string;
  paid: boolean;
  annualQuota: string;
  quotaYear: LeaveType['quotaYear'];
  halfDayAllowed: boolean;
  attachmentAfterDays: string;
  active: boolean;
  accrual: LeaveType['accrual'];
  carryForwardMax: string;
}

const MAX_TYPES = 30;

function draftOf(type: LeaveType): TypeDraft {
  return {
    key: type.key,
    nameEn: type.name.en,
    nameHi: type.name.hi,
    paid: type.paid,
    annualQuota: String(type.annualQuota),
    quotaYear: type.quotaYear,
    halfDayAllowed: type.halfDayAllowed,
    attachmentAfterDays:
      type.attachmentAfterDays === undefined ? '' : String(type.attachmentAfterDays),
    active: type.active,
    accrual: type.accrual,
    carryForwardMax: String(type.carryForwardMax),
  };
}

const EMPTY: TypeDraft = {
  key: '',
  nameEn: '',
  nameHi: '',
  paid: true,
  annualQuota: '0',
  quotaYear: 'calendar',
  halfDayAllowed: true,
  attachmentAfterDays: '',
  active: true,
  accrual: 'yearly',
  carryForwardMax: '0',
};

/**
 * Leave types (M13, spec 5.10, decision D81): whether each is paid, its days a year and when that
 * year runs, how they are credited and how many carry into the next year (D114), half days, and
 * when a document is needed. A type keeps its key once saved and is
 * switched off rather than removed, as requests name it.
 */
export function LeaveTypesPage() {
  const { client } = useApp();
  const { t } = useLanguage();
  const types = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => read(client, '/v1/leave-types', LeaveTypeListResult),
  });
  if (types.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(types.error, t)}
      </p>
    );
  }
  if (!types.data) return <p className="ks-muted">{t('common.loading')}</p>;
  return <Editor types={types.data.items} />;
}

function Editor({ types }: { types: readonly LeaveType[] }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState(() => types.map(draftOf));
  // Saved types lead the list; those after them are new until saved.
  const [savedCount, setSavedCount] = useState(types.length);
  const [failure, setFailure] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const change = (index: number, patch: Partial<TypeDraft>) =>
    setDrafts(drafts.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    setSaved(false);
    try {
      const result = await write(client, 'PUT', '/v1/leave-types', LeaveTypeListResult, {
        items: drafts.map((draft) => ({
          key: draft.key.trim(),
          name: { en: draft.nameEn.trim(), hi: draft.nameHi.trim() || draft.nameEn.trim() },
          paid: draft.paid,
          annualQuota: Number(draft.annualQuota),
          quotaYear: draft.quotaYear,
          halfDayAllowed: draft.halfDayAllowed,
          ...(draft.attachmentAfterDays.trim()
            ? { attachmentAfterDays: Number(draft.attachmentAfterDays) }
            : {}),
          active: draft.active,
          accrual: draft.accrual,
          carryForwardMax: Number(draft.carryForwardMax || 0),
        })),
      });
      if (result) {
        setDrafts(result.items.map(draftOf));
        setSavedCount(result.items.length);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['leave-types'] }),
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
      <PageHeader title={t('leave.types_title')} intro={t('leave.types_intro')} />
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
        <ol className="flex flex-col gap-4" aria-label={t('leave.types_title')}>
          {drafts.map((draft, index) => {
            const isNew = index >= savedCount;
            return (
              <li key={index} className="ks-card flex flex-col gap-3">
                <h2 className="heading-sm">{t('leave.type_n', { number: String(index + 1) })}</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    label={t('leave.key')}
                    help={isNew ? t('leave.key_help') : t('leave.key_kept')}
                    required
                    readOnly={!isNew}
                    value={draft.key}
                    {...at(index, 'key')}
                    onChange={(event) => change(index, { key: event.target.value })}
                  />
                  <span />
                  <TextField
                    label={t('leave.name_en')}
                    required
                    value={draft.nameEn}
                    {...at(index, 'name.en')}
                    onChange={(event) => change(index, { nameEn: event.target.value })}
                  />
                  <TextField
                    label={t('leave.name_hi')}
                    value={draft.nameHi}
                    {...at(index, 'name.hi')}
                    onChange={(event) => change(index, { nameHi: event.target.value })}
                  />
                  <TextField
                    label={t('leave.quota')}
                    help={t('leave.quota_help')}
                    inputMode="decimal"
                    required
                    value={draft.annualQuota}
                    {...at(index, 'annualQuota')}
                    onChange={(event) => change(index, { annualQuota: event.target.value })}
                  />
                  <SelectField
                    label={t('leave.quota_year')}
                    value={draft.quotaYear}
                    options={[
                      { value: 'calendar', label: t('leave.year_calendar') },
                      { value: 'financial', label: t('leave.year_financial') },
                    ]}
                    onChange={(event) =>
                      change(index, { quotaYear: event.target.value as TypeDraft['quotaYear'] })
                    }
                  />
                  <SelectField
                    label={t('leave.accrual')}
                    help={t('leave.accrual_help')}
                    value={draft.accrual}
                    options={[
                      { value: 'yearly', label: t('leave.accrual_yearly') },
                      { value: 'monthly', label: t('leave.accrual_monthly') },
                    ]}
                    onChange={(event) =>
                      change(index, { accrual: event.target.value as TypeDraft['accrual'] })
                    }
                  />
                  <TextField
                    label={t('leave.carry_forward')}
                    help={t('leave.carry_forward_help')}
                    inputMode="decimal"
                    value={draft.carryForwardMax}
                    {...at(index, 'carryForwardMax')}
                    onChange={(event) => change(index, { carryForwardMax: event.target.value })}
                  />
                  <TextField
                    label={t('leave.attachment_after')}
                    help={t('leave.attachment_help')}
                    inputMode="numeric"
                    value={draft.attachmentAfterDays}
                    {...at(index, 'attachmentAfterDays')}
                    onChange={(event) => change(index, { attachmentAfterDays: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Checkbox
                    label={t('leave.paid')}
                    detail={t('leave.paid_help')}
                    checked={draft.paid}
                    onChange={(event) => change(index, { paid: event.target.checked })}
                  />
                  <Checkbox
                    label={t('leave.half_day')}
                    checked={draft.halfDayAllowed}
                    onChange={(event) => change(index, { halfDayAllowed: event.target.checked })}
                  />
                  <Checkbox
                    label={t('leave.active')}
                    detail={t('leave.active_help')}
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
        <div className="flex flex-wrap gap-2">
          {drafts.length < MAX_TYPES ? (
            <Button icon={<Icon icon={Plus} />} onClick={() => setDrafts([...drafts, EMPTY])}>
              {t('leave.add')}
            </Button>
          ) : null}
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
            {t('leave.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
