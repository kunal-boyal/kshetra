import { formatMoney, formatMonth } from '@thelamp/i18n';
import { STATUTORY_STATES, type StatutoryProfileBody, todayIn } from '@thelamp/shared';
import { Button, Checkbox, Icon, SelectField, TextField } from '@thelamp/ui-web';
import { Save } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { fieldErrors, Section } from '../people/shared';
import { usePayrollWrites, useSalary, useStatutoryProfile } from './statutory-data';

const COMPONENTS = ['basic', 'da', 'hra', 'conveyance', 'special'] as const;
type Component = (typeof COMPONENTS)[number];

/**
 * A person's salary structure and statutory details (M14, BR-56, decision D128), for those who
 * keep salaries: each structure with the month it applies from and its wages under the codes, a
 * new structure from a month, and the work state, PF and ESI details a payslip prints.
 */
export function SalarySection({ userId }: { userId: string }) {
  const { t } = useLanguage();
  return (
    <Section title={t('salary.title')}>
      <Structures userId={userId} />
      <Profile userId={userId} />
    </Section>
  );
}

function Structures({ userId }: { userId: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const salary = useSalary(userId);
  const writes = usePayrollWrites();
  const thisMonth = todayIn(access.timezone).slice(0, 7);
  const [from, setFrom] = useState(thisMonth);
  const [amounts, setAmounts] = useState<Record<Component, string>>({
    basic: '',
    da: '',
    hra: '',
    conveyance: '',
    special: '',
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = fieldErrors(failure);
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: access.currency });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setFailure(undefined);
    try {
      await writes.setStructure(userId, {
        from,
        ...Object.fromEntries(
          COMPONENTS.map((key) => [key, amounts[key].trim().replaceAll(',', '') || '0']),
        ),
      });
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const changes = salary.data?.changes ?? [];
  return (
    <div className="flex flex-col gap-4">
      {salary.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(salary.error, t)}
        </p>
      ) : changes.length === 0 ? (
        <p className="ks-muted">{t('salary.none')}</p>
      ) : (
        <table className="ks-table">
          <caption className="heading-sm text-start">{t('salary.structures')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('payroll.from')}</th>
              {COMPONENTS.map((key) => (
                <th key={key} scope="col" className="text-end">
                  {t(`payslip.line_${key}`)}
                </th>
              ))}
              <th scope="col" className="text-end">
                {t('salary.gross')}
              </th>
              <th scope="col" className="text-end">
                {t('report.col_pf_wages')}
              </th>
            </tr>
          </thead>
          <tbody>
            {[...changes].reverse().map((change) => (
              <tr key={change.from}>
                <th scope="row">{formatMonth(change.from, { locale })}</th>
                {COMPONENTS.map((key) => (
                  <td key={key} className="text-end">
                    {money(change[key])}
                  </td>
                ))}
                <td className="text-end font-semibold">{money(change.gross)}</td>
                <td className="text-end">{money(change.wages)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        noValidate
        className="flex flex-col gap-3"
        aria-label={t('salary.new')}
        onSubmit={(event) => void submit(event)}
      >
        <h3 className="heading-sm">{t('salary.new')}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label={t('payroll.from')}
            type="month"
            required
            value={from}
            {...(errors.from ? { error: errors.from } : {})}
            onChange={(event) => setFrom(event.target.value)}
          />
          {COMPONENTS.map((key) => (
            <TextField
              key={key}
              label={t(`payslip.line_${key}`)}
              inputMode="decimal"
              numeric
              required={key === 'basic'}
              value={amounts[key]}
              {...(errors[key] ? { error: errors[key] } : {})}
              onChange={(event) =>
                setAmounts((current) => ({ ...current, [key]: event.target.value }))
              }
            />
          ))}
        </div>
        {failure !== undefined && Object.keys(errors).length === 0 ? (
          <p className="ks-help error" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            icon={<Icon icon={Save} />}
            disabled={!amounts.basic.trim()}
          >
            {t('salary.save')}
          </Button>
          {saved ? <span role="status">{t('salary.saved')}</span> : null}
        </div>
      </form>
    </div>
  );
}

function Profile({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const profile = useStatutoryProfile(userId);
  if (profile.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(profile.error, t)}
      </p>
    );
  }
  if (!profile.data) return <p className="ks-muted">{t('common.loading')}</p>;
  return <ProfileForm key={JSON.stringify(profile.data)} userId={userId} profile={profile.data} />;
}

function ProfileForm({ userId, profile }: { userId: string; profile: StatutoryProfileBody }) {
  const { t } = useLanguage();
  const writes = usePayrollWrites();
  const [draft, setDraft] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = fieldErrors(failure);
  const set = <K extends keyof StatutoryProfileBody>(key: K, value: StatutoryProfileBody[K]) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await writes.setProfile(userId, {
        ...draft,
        uan: draft.uan?.trim() || null,
        esiNumber: draft.esiNumber?.trim() || null,
      });
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      aria-label={t('salary.statutory')}
      onSubmit={(event) => void submit(event)}
    >
      <h3 className="heading-sm">{t('salary.statutory')}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label={t('payslip.work_state')}
          help={t('salary.work_state_help')}
          value={draft.workState ?? ''}
          none={t('salary.no_state')}
          options={STATUTORY_STATES.map((state) => ({ value: state, label: t(`state.${state}`) }))}
          onChange={(event) =>
            set('workState', (event.target.value || null) as StatutoryProfileBody['workState'])
          }
        />
        <TextField
          label={t('payslip.uan')}
          inputMode="numeric"
          value={draft.uan ?? ''}
          {...(errors.uan ? { error: errors.uan } : {})}
          onChange={(event) => set('uan', event.target.value)}
        />
        <TextField
          label={t('payslip.esi_number')}
          inputMode="numeric"
          value={draft.esiNumber ?? ''}
          {...(errors.esiNumber ? { error: errors.esiNumber } : {})}
          onChange={(event) => set('esiNumber', event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox
          label={t('salary.pf_member')}
          checked={draft.pfMember}
          onChange={(event) => set('pfMember', event.target.checked)}
        />
        <Checkbox
          label={t('salary.pf_full_wage')}
          checked={draft.pfFullWage}
          onChange={(event) => set('pfFullWage', event.target.checked)}
        />
        <Checkbox
          label={t('salary.pt_women')}
          checked={draft.ptWomen}
          onChange={(event) => set('ptWomen', event.target.checked)}
        />
        <Checkbox
          label={t('salary.pan_on_file')}
          checked={draft.panOnFile}
          onChange={(event) => set('panOnFile', event.target.checked)}
        />
      </div>
      {failure !== undefined && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" busy={busy} icon={<Icon icon={Save} />}>
          {t('salary.save_statutory')}
        </Button>
        {saved ? <span role="status">{t('salary.saved')}</span> : null}
      </div>
    </form>
  );
}
