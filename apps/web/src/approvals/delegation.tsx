import { formatDate } from '@thelamp/i18n';
import { type ApprovalDelegation, newId, todayIn } from '@thelamp/shared';
import {
  Button,
  Confirm,
  Icon,
  Notice,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { CircleCheck, Plane, UserRoundCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { useMe } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { fieldErrors } from '../people/shared';
import { useDelegateCandidates, useDelegationChanges, useDelegations } from './data';

/**
 * While you're away (M15, decision D113): who decides for the viewer on which days, what they
 * decide for others, and handing over. A handover adds a decider; the viewer can still decide.
 */
export function AwayCard() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const me = useMe(client).data;
  const delegations = useDelegations();
  const candidates = useDelegateCandidates();
  const changes = useDelegationChanges();
  const today = todayIn(access.timezone);
  const [delegateId, setDelegateId] = useState('');
  const [from, setFrom] = useState(today);
  const [until, setUntil] = useState(today);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [ending, setEnding] = useState<string | null>(null);
  const errors = fieldErrors(failure);
  const day = (date: string) => formatDate(date, { locale });
  const standing = (delegations.data?.items ?? []).filter(
    (entry) => entry.state === 'active' || entry.state === 'upcoming',
  );
  const given = standing.filter((entry) => entry.delegator.id === me?.userId);
  const received = standing.filter((entry) => entry.delegate.id === me?.userId);
  const options = (candidates.data?.items ?? [])
    .filter((person) => person.id !== me?.userId)
    .map((person) => ({ value: person.id, label: `${person.name} (${person.code})` }));

  async function hand(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setFailure(undefined);
    try {
      await changes.hand({ id: newId(), delegateId, startsOn: from, endsOn: until });
      setSaved(true);
      setDelegateId('');
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  async function end(id: string) {
    setBusy(true);
    setFailure(undefined);
    try {
      await changes.end(id);
      setEnding(null);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const state = (entry: ApprovalDelegation) => (
    <StatusBadge variant={entry.state === 'active' ? 'success' : 'info'}>
      {t(
        entry.state === 'active' ? 'approvals.away_state_active' : 'approvals.away_state_upcoming',
      )}
    </StatusBadge>
  );

  return (
    <section className="ks-card flex flex-col gap-4" aria-labelledby="away-title">
      <div className="flex items-start gap-3">
        <span className="ks-ico" aria-hidden="true">
          <Icon icon={Plane} />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="heading-md" id="away-title">
            {t('approvals.away_title')}
          </h2>
          <p className="ks-muted">{t('approvals.away_intro')}</p>
        </div>
      </div>
      {given.length + received.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {given.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-3">
              {state(entry)}
              <span className="flex-1">
                {t('approvals.away_given', {
                  name: entry.delegate.name,
                  from: day(entry.startsOn),
                  until: day(entry.endsOn),
                })}
              </span>
              {ending === entry.id ? (
                <Confirm
                  question={t('approvals.away_end_question')}
                  action={
                    <Button
                      variant="danger"
                      size="sm"
                      busy={busy}
                      onClick={() => void end(entry.id)}
                    >
                      {t('approvals.away_end')}
                    </Button>
                  }
                  cancel={
                    <Button size="sm" variant="secondary" onClick={() => setEnding(null)}>
                      {t('common.cancel')}
                    </Button>
                  }
                />
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setEnding(entry.id)}>
                  {t('approvals.away_end')}
                </Button>
              )}
            </li>
          ))}
          {received.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-3">
              {state(entry)}
              <Icon icon={UserRoundCheck} size="sm" />
              <span>
                {t('approvals.away_received', {
                  name: entry.delegator.name,
                  from: day(entry.startsOn),
                  until: day(entry.endsOn),
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {saved ? (
        <Notice icon={<Icon icon={CircleCheck} />}>{t('approvals.away_saved')}</Notice>
      ) : null}
      <form
        className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-start"
        onSubmit={(event) => void hand(event)}
        noValidate
      >
        <SelectField
          label={t('approvals.away_delegate')}
          value={delegateId}
          none={t('approvals.away_choose')}
          options={options}
          {...(errors.delegateId ? { error: errors.delegateId } : {})}
          onChange={(event) => setDelegateId(event.target.value)}
        />
        <TextField
          label={t('approvals.away_from')}
          type="date"
          min={today}
          value={from}
          {...(errors.startsOn ? { error: errors.startsOn } : {})}
          onChange={(event) => setFrom(event.target.value)}
        />
        <TextField
          label={t('approvals.away_until')}
          type="date"
          min={from}
          value={until}
          {...(errors.endsOn ? { error: errors.endsOn } : {})}
          onChange={(event) => setUntil(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!delegateId}
          className="md:mt-6"
        >
          {t('approvals.away_save')}
        </Button>
      </form>
      {failure !== undefined && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
    </section>
  );
}
