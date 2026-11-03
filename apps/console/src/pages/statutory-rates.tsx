import { Link } from '@tanstack/react-router';
import { StatutoryRateSet, type StatutoryRatesResult } from '@thelamp/shared';
import {
  Button,
  Card,
  Notice,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '@thelamp/ui-web';
import { ArrowLeft } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useConsole } from '../context';
import { useConsoleMutations, useStatutoryRates } from '../data';
import { UnshownErrors } from '../fields';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';
import { holds } from './shared';

/**
 * Statutory payroll's rates (decision D128): the dated rate sets every cell works payslips out
 * on, newest last, each with its chartered accountant's reviews. Sets are only ever added, so a
 * payslip keeps the figures it was worked out on; a review lifts the "awaiting review" label for
 * that set under the rules' current version.
 */
export function StatutoryRatesPage() {
  const { client } = useConsole();
  const { t } = useLanguage();
  const rates = useStatutoryRates();
  const manages = holds(client.staff, 'platform.billing.manage');
  return (
    <>
      <Link to="/billing" className="ks-btn ghost sm self-start">
        <ArrowLeft size={16} aria-hidden="true" />
        {t('console.billing')}
      </Link>
      <h1 className="heading-xl">{t('console.statutory_rates')}</h1>
      <p className="ks-muted">{t('console.statutory_rates_intro')}</p>
      {rates.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(rates.error, t)}
        </p>
      ) : !rates.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          {rates.data.reference ? <Notice>{t('console.statutory_reference')}</Notice> : null}
          <ul className="flex flex-col gap-3" aria-label={t('console.statutory_sets')}>
            {rates.data.sets.map((set) => (
              <li key={set.id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="heading-md">
                      {t('console.statutory_set', { id: set.id, from: set.from })}
                    </span>
                    <StatusBadge variant={set.reviewed ? 'success' : 'pending'}>
                      {t(
                        set.reviewed ? 'console.statutory_reviewed' : 'console.statutory_awaiting',
                      )}
                    </StatusBadge>
                  </div>
                  <p className="ks-muted text-sm">
                    {t('console.statutory_ceilings', {
                      pf: set.rates.pf.wageCeiling,
                      esi: set.rates.esi.wageLimit,
                    })}
                  </p>
                  {set.notes ? <p className="text-sm">{set.notes}</p> : null}
                  {set.reviews.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-sm">
                      {set.reviews.map((review) => (
                        <li key={`${review.reviewer}:${review.reviewedOn}:${review.rulesVersion}`}>
                          {t('console.statutory_review_line', {
                            reviewer: review.reviewer,
                            on: review.reviewedOn,
                            version: review.rulesVersion,
                          })}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
          {manages ? (
            <>
              <ReviewForm rates={rates.data} />
              <AddSetForm rates={rates.data} />
            </>
          ) : null}
        </>
      )}
    </>
  );
}

function ReviewForm({ rates }: { rates: StatutoryRatesResult }) {
  const { t } = useLanguage();
  const { recordStatutoryReview } = useConsoleMutations();
  const [rateSetId, setRateSetId] = useState(rates.sets.at(-1)?.id ?? '');
  const [reviewer, setReviewer] = useState('');
  const [reviewedOn, setReviewedOn] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const errors = fieldErrors(recordStatutoryReview.error);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    await recordStatutoryReview.mutateAsync({ rateSetId, reviewer, reviewedOn, note });
    setDone(true);
  }

  return (
    <Card>
      <form
        noValidate
        className="flex flex-col gap-3"
        aria-label={t('console.statutory_review')}
        onSubmit={(event) => void submit(event).catch(() => {})}
      >
        <h2 className="heading-md">{t('console.statutory_review')}</h2>
        <p className="ks-muted text-sm">
          {t('console.statutory_review_help', { version: rates.rulesVersion })}
        </p>
        <UnshownErrors errors={errors} shown={['reviewer', 'reviewedOn']} />
        <div className="grid gap-3 md:grid-cols-3">
          <SelectField
            label={t('console.statutory_review_set')}
            value={rateSetId}
            options={rates.sets.map((set) => ({ value: set.id, label: `${set.id} (${set.from})` }))}
            onChange={(event) => setRateSetId(event.target.value)}
          />
          <TextField
            label={t('console.statutory_reviewer')}
            required
            value={reviewer}
            {...(errors.reviewer ? { error: errors.reviewer } : {})}
            onChange={(event) => setReviewer(event.target.value)}
          />
          <TextField
            label={t('console.statutory_reviewed_on')}
            type="date"
            required
            value={reviewedOn}
            {...(errors.reviewedOn ? { error: errors.reviewedOn } : {})}
            onChange={(event) => setReviewedOn(event.target.value)}
          />
        </div>
        <TextAreaField
          label={t('console.statutory_review_note')}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {recordStatutoryReview.error && Object.keys(errors).length === 0 ? (
          <p className="ks-help error" role="alert">
            {errorMessage(recordStatutoryReview.error, t)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            busy={recordStatutoryReview.isPending}
            disabled={!reviewer.trim() || !reviewedOn}
          >
            {t('console.statutory_record_review')}
          </Button>
          {done ? <span role="status">{t('console.saved')}</span> : null}
        </div>
      </form>
    </Card>
  );
}

/** A new set from a date, written as the rate set's JSON, checked before it is sent. */
function AddSetForm({ rates }: { rates: StatutoryRatesResult }) {
  const { t } = useLanguage();
  const { addStatutoryRateSet } = useConsoleMutations();
  const latest = rates.sets.at(-1);
  const [text, setText] = useState(() =>
    JSON.stringify(
      latest
        ? { id: '', from: '', rates: latest.rates, notes: '' }
        : { id: '', from: '', rates: {}, notes: '' },
      null,
      2,
    ),
  );
  const [issue, setIssue] = useState<string>();
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    setIssue(undefined);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setIssue(t('console.statutory_json_issue'));
      return;
    }
    const checked = StatutoryRateSet.safeParse(parsed);
    if (!checked.success) {
      const first = checked.error.issues[0];
      setIssue(`${first?.path.join('.') ?? ''}: ${first?.message ?? ''}`);
      return;
    }
    await addStatutoryRateSet.mutateAsync(checked.data);
    setDone(true);
  }

  return (
    <Card>
      <form
        noValidate
        className="flex flex-col gap-3"
        aria-label={t('console.statutory_add')}
        onSubmit={(event) => void submit(event).catch(() => {})}
      >
        <h2 className="heading-md">{t('console.statutory_add')}</h2>
        <p className="ks-muted text-sm">{t('console.statutory_add_help')}</p>
        <UnshownErrors errors={fieldErrors(addStatutoryRateSet.error)} shown={[]} named />
        <TextAreaField
          label={t('console.statutory_json')}
          rows={14}
          value={text}
          {...(issue ? { error: issue } : {})}
          onChange={(event) => setText(event.target.value)}
        />
        {addStatutoryRateSet.error ? (
          <p className="ks-help error" role="alert">
            {errorMessage(addStatutoryRateSet.error, t)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" busy={addStatutoryRateSet.isPending}>
            {t('console.statutory_add_button')}
          </Button>
          {done ? <span role="status">{t('console.saved')}</span> : null}
        </div>
      </form>
    </Card>
  );
}
