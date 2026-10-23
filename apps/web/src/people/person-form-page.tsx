import { UserResult, type UserView } from '@thelamp/shared';
import { Button, Checkbox, ChoiceGroup, Icon, SelectField, TextField } from '@thelamp/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Save } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { CustomFieldInputs, type Values } from './custom-fields';
import {
  useDesignations,
  useRefreshPeople,
  useRoles,
  useTerritories,
  useUser,
  useUserFields,
  write,
} from './data';
import { type PickedPerson, PersonPicker } from './person-picker';
import { fieldErrors, PageHeader } from './shared';

/** Text inputs hold strings; an empty one means "leave out" or "clear". */
interface Draft {
  code: string;
  name: string;
  phone: string;
  email: string;
  designation: string;
  role: string;
  manager: PickedPerson | null;
  joiningDate: string;
  exitDate: string;
  territoryIds: string[];
  custom: Values;
}

function draftOf(user: UserView | undefined): Draft {
  return {
    code: user?.code ?? '',
    name: user?.name ?? '',
    phone: user?.phone ?? '',
    email: user?.email ?? '',
    designation: user?.designation ?? '',
    role: user?.role ?? '',
    manager: user?.manager ?? null,
    joiningDate: user?.joiningDate ?? '',
    exitDate: user?.exitDate ?? '',
    territoryIds: user?.territories.map((territory) => territory.id) ?? [],
    custom: user?.custom ?? {},
  };
}

/** Values the form shows as text go back as the API reads them: blanks become nothing. */
function customForCreate(values: Values): Values {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) =>
        value !== null && value !== '' && !(Array.isArray(value) && value.length === 0),
    ),
  );
}

export function NewPersonPage() {
  return <PersonForm />;
}

export function EditPersonPage({ userId }: { userId: string }) {
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
  return <PersonForm user={user.data} />;
}

/**
 * Adding a person, or changing one (spec 5.3, M3). A change sends only what changed. Territories
 * are chosen when adding; afterwards they move with transfers, which keep their dates.
 */
function PersonForm({ user }: { user?: UserView }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const refresh = useRefreshPeople();
  const designations = useDesignations();
  const roles = useRoles();
  const territories = useTerritories();
  const fields = useUserFields();
  const [draft, setDraft] = useState<Draft>(() => draftOf(user));
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function body(): Record<string, unknown> {
    const text = (value: string) => value.trim();
    if (!user) {
      return {
        code: text(draft.code),
        name: text(draft.name),
        ...(text(draft.phone) ? { phone: text(draft.phone) } : {}),
        ...(text(draft.email) ? { email: text(draft.email) } : {}),
        designation: draft.designation,
        ...(draft.role ? { role: draft.role } : {}),
        managerId: draft.manager?.id ?? null,
        ...(draft.joiningDate ? { joiningDate: draft.joiningDate } : {}),
        ...(draft.exitDate ? { exitDate: draft.exitDate } : {}),
        territoryIds: draft.territoryIds,
        custom: customForCreate(draft.custom),
      };
    }
    const before = draftOf(user);
    const changes: Record<string, unknown> = {};
    for (const key of ['code', 'name', 'designation', 'role'] as const) {
      if (text(draft[key]) !== before[key]) changes[key] = text(draft[key]);
    }
    for (const key of ['phone', 'email', 'joiningDate', 'exitDate'] as const) {
      if (text(draft[key]) !== before[key]) changes[key] = text(draft[key]) || null;
    }
    if ((draft.manager?.id ?? null) !== user.managerId)
      changes.managerId = draft.manager?.id ?? null;
    const custom: Values = {};
    for (const key of new Set([...Object.keys(draft.custom), ...Object.keys(before.custom)])) {
      const now = draft.custom[key];
      if (JSON.stringify(now) === JSON.stringify(before.custom[key])) continue;
      const blank = now === '' || now === null || (Array.isArray(now) && now.length === 0);
      custom[key] = blank ? null : now;
    }
    if (Object.keys(custom).length > 0) changes.custom = custom;
    return changes;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setBusy(true);
    try {
      const payload = body();
      let id = user?.id;
      if (!user) {
        // The server checks everything and answers field by field.
        const created = await write(client, 'POST', '/v1/users', UserResult, payload);
        id = created!.id;
      } else if (Object.keys(payload).length > 0) {
        await write(client, 'PATCH', `/v1/users/${user.id}`, UserResult, payload);
      }
      await refresh(id);
      await navigate({ to: '/people/$userId', params: { userId: id! } });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const title = user ? t('person.edit_title', { name: user.name }) : t('person.new_title');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        back={
          user
            ? { to: '/people/$userId', params: { userId: user.id }, label: user.name }
            : { to: '/people', label: t('people.title') }
        }
      />
      <form
        className="ks-card flex max-w-2xl flex-col gap-4"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        {failure ? (
          <p className="ks-help error" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t('person.code')}
            help={t('person.code_help')}
            required
            value={draft.code}
            {...(errors.code ? { error: errors.code } : {})}
            onChange={(event) => set('code', event.target.value)}
          />
          <TextField
            label={t('person.name')}
            required
            value={draft.name}
            {...(errors.name ? { error: errors.name } : {})}
            onChange={(event) => set('name', event.target.value)}
          />
          <TextField
            label={t('person.mobile')}
            help={t('person.mobile_help')}
            type="tel"
            inputMode="tel"
            value={draft.phone}
            {...(errors.phone ? { error: errors.phone } : {})}
            onChange={(event) => set('phone', event.target.value)}
          />
          <TextField
            label={t('person.email')}
            type="email"
            value={draft.email}
            {...(errors.email ? { error: errors.email } : {})}
            onChange={(event) => set('email', event.target.value)}
          />
          <SelectField
            label={t('person.designation')}
            required
            value={draft.designation}
            none="—"
            options={(designations.data ?? []).map((entry) => ({
              value: entry.key,
              label: entry.name[locale].one,
            }))}
            {...(errors.designation ? { error: errors.designation } : {})}
            onChange={(event) => set('designation', event.target.value)}
          />
          <SelectField
            label={t('person.role')}
            value={draft.role}
            {...(user ? {} : { none: t('person.role_default') })}
            options={(roles.data ?? []).map((role) => ({
              value: role.key,
              label: role.name[locale],
            }))}
            {...(errors.role ? { error: errors.role } : {})}
            onChange={(event) => set('role', event.target.value)}
          />
          <TextField
            label={t('person.joining_date')}
            type="date"
            value={draft.joiningDate}
            {...(errors.joiningDate ? { error: errors.joiningDate } : {})}
            onChange={(event) => set('joiningDate', event.target.value)}
          />
          <TextField
            label={t('person.exit_date')}
            type="date"
            value={draft.exitDate}
            {...(errors.exitDate ? { error: errors.exitDate } : {})}
            onChange={(event) => set('exitDate', event.target.value)}
          />
        </div>
        <PersonPicker
          label={t('person.manager')}
          value={draft.manager}
          none={t('people.top')}
          {...(user ? { exclude: user.id } : {})}
          {...(errors.managerId ? { error: errors.managerId } : {})}
          onChange={(manager) => set('manager', manager)}
        />
        {!user && (territories.data ?? []).some((territory) => territory.active) ? (
          <ChoiceGroup
            legend={t('person.territories')}
            {...(errors['territoryIds[0]'] ? { error: errors['territoryIds[0]'] } : {})}
            className="max-h-64 overflow-y-auto"
          >
            {(territories.data ?? [])
              .filter((territory) => territory.active)
              .map((territory) => (
                // Each level sits a step further in, so the tree reads as one.
                <div
                  key={territory.id}
                  style={{ paddingLeft: `calc(var(--space-4) * ${territory.level - 1})` }}
                >
                  <Checkbox
                    label={territory.name}
                    detail={territory.code}
                    checked={draft.territoryIds.includes(territory.id)}
                    onChange={(event) =>
                      set(
                        'territoryIds',
                        event.target.checked
                          ? [...draft.territoryIds, territory.id]
                          : draft.territoryIds.filter((id) => id !== territory.id),
                      )
                    }
                  />
                </div>
              ))}
          </ChoiceGroup>
        ) : null}
        {(fields.data?.fields.length ?? 0) > 0 ? (
          <fieldset className="flex flex-col gap-4">
            <legend className="heading-md">{t('person.more')}</legend>
            <CustomFieldInputs
              fields={fields.data!.fields}
              values={draft.custom}
              errors={errors}
              onChange={(key, value) => set('custom', { ...draft.custom, [key]: value })}
            />
          </fieldset>
        ) : null}
        <div>
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
            {user ? t('common.save') : t('person.create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
