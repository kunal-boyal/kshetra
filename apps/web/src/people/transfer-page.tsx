import { todayIn, TransferResult, type UserView } from '@thelamp/shared';
import { Button, Checkbox, ChoiceGroup, Icon, SelectField, TextField } from '@thelamp/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRightLeft } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import {
  useAccess,
  useDesignations,
  useRefreshPeople,
  useRoles,
  useTerritories,
  useUser,
  write,
} from './data';
import { type PickedPerson, PersonPicker } from './person-picker';
import { fieldErrors, PageHeader } from './shared';

export function TransferPage({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const user = useUser(userId);
  if (user.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  if (user.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(user.error, t)}
      </p>
    );
  }
  return <TransferForm user={user.data} />;
}

/** "Keep as it is" for a manager: nothing chosen yet. */
const KEEP = 'keep';

/**
 * A transfer (M3): another manager, designation, role or territories from a day on. Anything left
 * as it is stays. Today applies at once; a later day waits for that day.
 */
function TransferForm({ user }: { user: UserView }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const refresh = useRefreshPeople();
  const designations = useDesignations();
  const roles = useRoles();
  const territories = useTerritories();
  const [effectiveDate, setEffectiveDate] = useState(() => todayIn(access.timezone));
  const [manager, setManager] = useState<PickedPerson | null | typeof KEEP>(KEEP);
  const [designation, setDesignation] = useState('');
  const [role, setRole] = useState('');
  const [moveTerritories, setMoveTerritories] = useState(false);
  const [territoryIds, setTerritoryIds] = useState(() =>
    user.territories.map((territory) => territory.id),
  );
  const [failure, setFailure] = useState<unknown>();
  const [nothing, setNothing] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const changes = {
      ...(manager !== KEEP ? { managerId: manager?.id ?? null } : {}),
      ...(designation ? { designation } : {}),
      ...(role ? { role } : {}),
      ...(moveTerritories ? { territoryIds } : {}),
    };
    setNothing(Object.keys(changes).length === 0);
    if (Object.keys(changes).length === 0) return;
    setFailure(undefined);
    setBusy(true);
    try {
      await write(client, 'POST', `/v1/users/${user.id}/transfers`, TransferResult, {
        effectiveDate,
        ...changes,
      });
      await refresh(user.id);
      await navigate({ to: '/people/$userId', params: { userId: user.id } });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('transfer.title', { name: user.name })}
        intro={t('transfer.intro')}
        back={{ to: '/people/$userId', params: { userId: user.id }, label: user.name }}
      />
      <form
        className="ks-card flex max-w-2xl flex-col gap-4"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        {nothing || failure ? (
          <p className="ks-help error" role="alert">
            {nothing ? t('transfer.nothing') : errorMessage(failure, t)}
          </p>
        ) : null}
        <TextField
          label={t('transfer.from')}
          help={t('transfer.from_help')}
          type="date"
          required
          min={todayIn(access.timezone)}
          value={effectiveDate}
          {...(errors.effectiveDate ? { error: errors.effectiveDate } : {})}
          onChange={(event) => setEffectiveDate(event.target.value)}
        />
        <PersonPicker
          label={t('person.manager')}
          value={manager === KEEP ? (user.manager ?? null) : manager}
          none={t('people.top')}
          exclude={user.id}
          {...(errors.managerId ? { error: errors.managerId } : {})}
          onChange={setManager}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t('person.designation')}
            value={designation}
            none={t('transfer.keep')}
            options={(designations.data ?? []).map((entry) => ({
              value: entry.key,
              label: entry.name[locale].one,
            }))}
            {...(errors.designation ? { error: errors.designation } : {})}
            onChange={(event) => setDesignation(event.target.value)}
          />
          <SelectField
            label={t('person.role')}
            value={role}
            none={t('transfer.keep')}
            options={(roles.data ?? []).map((entry) => ({
              value: entry.key,
              label: entry.name[locale],
            }))}
            {...(errors.role ? { error: errors.role } : {})}
            onChange={(event) => setRole(event.target.value)}
          />
        </div>
        <Checkbox
          label={t('transfer.change_territories')}
          checked={moveTerritories}
          onChange={(event) => setMoveTerritories(event.target.checked)}
        />
        {moveTerritories ? (
          <ChoiceGroup
            legend={t('person.territories')}
            {...(errors['territoryIds[0]'] ? { error: errors['territoryIds[0]'] } : {})}
            className="max-h-64 overflow-y-auto"
          >
            {(territories.data ?? [])
              .filter((territory) => territory.active)
              .map((territory) => (
                <div
                  key={territory.id}
                  style={{ paddingLeft: `calc(var(--space-4) * ${territory.level - 1})` }}
                >
                  <Checkbox
                    label={territory.name}
                    detail={territory.code}
                    checked={territoryIds.includes(territory.id)}
                    onChange={(event) =>
                      setTerritoryIds((current) =>
                        event.target.checked
                          ? [...current, territory.id]
                          : current.filter((id) => id !== territory.id),
                      )
                    }
                  />
                </div>
              ))}
          </ChoiceGroup>
        ) : null}
        <div>
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={ArrowRightLeft} />}>
            {t('transfer.submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}
