import type { AccountTypeView } from '@thelamp/forms';
import { AccountListResult, AccountResult, newId, todayIn } from '@thelamp/shared';
import { Button, Icon, SelectField, TextField } from '@thelamp/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Save } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { CustomFieldInputs, type Values } from '../people/custom-fields';
import { read, useAccess, useTerritories, write } from '../people/data';
import { type PickedPerson, PersonPicker } from '../people/person-picker';
import { fieldErrors, PageHeader } from '../people/shared';
import { useAccountOverview, useAccountTypes, useRefreshAccounts } from './data';

/** Text inputs hold strings; an empty one means "leave out" or "clear". */
interface Draft {
  code: string;
  name: string;
  territoryId: string;
  parentId: string;
  line: string;
  city: string;
  state: string;
  pin: string;
  lat: string;
  lng: string;
  radius: string;
  slots: Record<string, PickedPerson | null>;
  slotsFrom: string;
  custom: Values;
}

function draftOf(account: AccountResult | undefined, today: string): Draft {
  return {
    code: account?.code ?? '',
    name: account?.name ?? '',
    territoryId: account?.territory.id ?? '',
    parentId: account?.parent?.id ?? '',
    line: account?.address.line ?? '',
    city: account?.address.city ?? '',
    state: account?.address.state ?? '',
    pin: account?.address.pin ?? '',
    lat: account?.location ? String(account.location.lat) : '',
    lng: account?.location ? String(account.location.lng) : '',
    radius: account?.geofenceRadiusM ? String(account.geofenceRadiusM) : '',
    slots: Object.fromEntries((account?.slots ?? []).map((holder) => [holder.slot, holder.user])),
    slotsFrom: today,
    custom: account?.custom ?? {},
  };
}

export function NewAccountPage({ type: key }: { type?: string }) {
  const { t } = useLanguage();
  const type = useAccountTypes()?.find((entry) => entry.key === key && entry.active);
  if (!type) return <p className="ks-muted">{t('common.loading')}</p>;
  return <AccountForm type={type} />;
}

export function EditAccountPage({ accountId }: { accountId: string }) {
  const { t } = useLanguage();
  const overview = useAccountOverview(accountId);
  const types = useAccountTypes();
  if (overview.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(overview.error, t)}
      </p>
    );
  }
  const type = types?.find((entry) => entry.key === overview.data?.account.type);
  if (!overview.data || !type) return <p className="ks-muted">{t('common.loading')}</p>;
  return <AccountForm type={type} account={overview.data.account} />;
}

/** The parents an account may have: active accounts of the types its type allows. */
function useParents(type: AccountTypeView) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['account-parents', type.parentTypes],
    queryFn: async () =>
      (
        await Promise.all(
          type.parentTypes.map((parent) =>
            read(client, `/v1/accounts?type=${parent}&status=active&limit=200`, AccountListResult),
          ),
        )
      ).flatMap((page) => page.items),
    enabled: type.parentTypes.length > 0,
  });
}

/**
 * Adding an account, or changing one (spec 5.5, M4). A change sends only what changed; a change
 * of who fills the slots applies from the day chosen, today unless later.
 */
function AccountForm({ type, account }: { type: AccountTypeView; account?: AccountResult }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const refresh = useRefreshAccounts();
  const territories = useTerritories();
  const parents = useParents(type);
  const today = todayIn(access.timezone);
  const [draft, setDraft] = useState<Draft>(() => draftOf(account, today));
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const auto = type.code.mode === 'auto';
  const fields = type.fields.filter((field) => !['photo', 'product_lines'].includes(field.type));

  function body(): Record<string, unknown> {
    const text = (value: string) => value.trim();
    const address = Object.fromEntries(
      (['line', 'city', 'state', 'pin'] as const).flatMap((key) =>
        text(draft[key]) ? [[key, text(draft[key])]] : [],
      ),
    );
    const location =
      text(draft.lat) && text(draft.lng)
        ? { lat: Number(draft.lat), lng: Number(draft.lng) }
        : null;
    const radius = text(draft.radius) ? Number(draft.radius) : null;
    if (!account) {
      return {
        id: newId(),
        type: type.key,
        ...(text(draft.code) ? { code: text(draft.code) } : {}),
        name: text(draft.name),
        territoryId: draft.territoryId,
        ...(draft.parentId ? { parentId: draft.parentId } : {}),
        address,
        ...(location ? { location } : {}),
        ...(radius ? { geofenceRadiusM: radius } : {}),
        slots: Object.fromEntries(
          Object.entries(draft.slots).flatMap(([slot, person]) =>
            person ? [[slot, person.id]] : [],
          ),
        ),
        custom: Object.fromEntries(
          Object.entries(draft.custom).filter(
            ([, value]) =>
              value !== null && value !== '' && !(Array.isArray(value) && value.length === 0),
          ),
        ),
      };
    }
    const before = draftOf(account, today);
    const changes: Record<string, unknown> = {};
    if (text(draft.code) !== before.code) changes.code = text(draft.code);
    if (text(draft.name) !== before.name) changes.name = text(draft.name);
    if (draft.territoryId !== before.territoryId) changes.territoryId = draft.territoryId;
    if (draft.parentId !== before.parentId) changes.parentId = draft.parentId || null;
    if (
      (['line', 'city', 'state', 'pin'] as const).some((key) => text(draft[key]) !== before[key])
    ) {
      changes.address = address;
    }
    if (text(draft.lat) !== before.lat || text(draft.lng) !== before.lng)
      changes.location = location;
    if (text(draft.radius) !== before.radius) changes.geofenceRadiusM = radius;
    const holders: Record<string, string | null> = {};
    for (const slot of type.slots) {
      const now = draft.slots[slot.key]?.id ?? null;
      if (now !== (before.slots[slot.key]?.id ?? null)) holders[slot.key] = now;
    }
    if (Object.keys(holders).length > 0) {
      changes.slots = { holders, ...(draft.slotsFrom !== today ? { from: draft.slotsFrom } : {}) };
    }
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
      let id = account?.id;
      if (!account) {
        const created = await write(client, 'POST', '/v1/accounts', AccountResult, payload);
        id = created!.id;
      } else if (Object.keys(payload).length > 0) {
        await write(client, 'PATCH', `/v1/accounts/${account.id}`, AccountResult, payload);
      }
      await refresh(id);
      await navigate({ to: '/accounts/$accountId', params: { accountId: id! } });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const title = account
    ? t('account.edit_title', { name: account.name })
    : t('accounts.add', { type: type.name[locale].one });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        back={
          account
            ? { to: '/accounts/$accountId', params: { accountId: account.id }, label: account.name }
            : { to: '/accounts', label: type.name[locale].other }
        }
      />
      <form
        className="ks-card flex max-w-3xl flex-col gap-4"
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
            label={t('account.name')}
            required
            value={draft.name}
            {...(errors.name ? { error: errors.name } : {})}
            onChange={(event) => set('name', event.target.value)}
          />
          <TextField
            label={t('account.code')}
            help={
              auto
                ? t('account.code_auto', {
                    prefix: type.code.mode === 'auto' ? type.code.prefix : '',
                  })
                : undefined
            }
            required={!auto}
            value={draft.code}
            {...(errors.code ? { error: errors.code } : {})}
            onChange={(event) => set('code', event.target.value)}
          />
          <SelectField
            label={t('account.territory')}
            required
            value={draft.territoryId}
            none="—"
            options={(territories.data ?? [])
              .filter((node) => node.active || node.id === draft.territoryId)
              .map((node) => ({
                value: node.id,
                // Each level a step in, as the tree reads.
                label: `${' '.repeat((node.level - 1) * 2)}${node.name} (${node.code})`,
              }))}
            {...(errors.territoryId ? { error: errors.territoryId } : {})}
            onChange={(event) => set('territoryId', event.target.value)}
          />
          {type.parentTypes.length > 0 ? (
            <SelectField
              label={t('account.parent')}
              value={draft.parentId}
              none={t('account.no_parent')}
              options={(parents.data ?? [])
                .filter((parent) => parent.id !== account?.id)
                .map((parent) => ({ value: parent.id, label: `${parent.name} (${parent.code})` }))}
              {...(errors.parentId ? { error: errors.parentId } : {})}
              onChange={(event) => set('parentId', event.target.value)}
            />
          ) : null}
        </div>

        <fieldset className="flex flex-col gap-4">
          <legend className="heading-md">{t('account.address')}</legend>
          <TextField
            label={t('account.address_line')}
            value={draft.line}
            {...(errors['address.line'] ? { error: errors['address.line'] } : {})}
            onChange={(event) => set('line', event.target.value)}
          />
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              label={t('account.city')}
              value={draft.city}
              onChange={(event) => set('city', event.target.value)}
            />
            <TextField
              label={t('account.state')}
              value={draft.state}
              onChange={(event) => set('state', event.target.value)}
            />
            <TextField
              label={t('account.pin')}
              inputMode="numeric"
              value={draft.pin}
              {...(errors['address.pin'] ? { error: errors['address.pin'] } : {})}
              onChange={(event) => set('pin', event.target.value)}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="heading-md">{t('account.location')}</legend>
          <p className="ks-muted">{t('account.location_help')}</p>
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              label={t('account.latitude')}
              inputMode="decimal"
              numeric
              value={draft.lat}
              {...(errors['location.lat'] ? { error: errors['location.lat'] } : {})}
              onChange={(event) => set('lat', event.target.value)}
            />
            <TextField
              label={t('account.longitude')}
              inputMode="decimal"
              numeric
              value={draft.lng}
              {...(errors['location.lng'] ? { error: errors['location.lng'] } : {})}
              onChange={(event) => set('lng', event.target.value)}
            />
            <TextField
              label={t('account.radius')}
              help={t('account.radius_help')}
              inputMode="numeric"
              numeric
              value={draft.radius}
              {...(errors.geofenceRadiusM ? { error: errors.geofenceRadiusM } : {})}
              onChange={(event) => set('radius', event.target.value)}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="heading-md">{t('account.slots')}</legend>
          {type.slots.map((slot) => (
            <PersonPicker
              key={slot.key}
              label={slot.required ? `${slot.name[locale]} *` : slot.name[locale]}
              value={draft.slots[slot.key] ?? null}
              none={t('account.slot_empty')}
              designations={slot.designations}
              {...(errors[`slots.${slot.key}`] ? { error: errors[`slots.${slot.key}`] } : {})}
              onChange={(person) => set('slots', { ...draft.slots, [slot.key]: person })}
            />
          ))}
          {account ? (
            <TextField
              label={t('account.slots_from')}
              help={t('account.slots_from_help')}
              type="date"
              min={today}
              value={draft.slotsFrom}
              {...(errors['slots.from'] ? { error: errors['slots.from'] } : {})}
              onChange={(event) => set('slotsFrom', event.target.value)}
            />
          ) : null}
        </fieldset>

        {fields.length > 0 ? (
          <fieldset className="flex flex-col gap-4">
            <legend className="heading-md">{t('account.more')}</legend>
            <CustomFieldInputs
              fields={fields}
              values={draft.custom}
              errors={errors}
              onChange={(key, value) => set('custom', { ...draft.custom, [key]: value })}
            />
          </fieldset>
        ) : null}
        <div>
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
            {account ? t('common.save') : t('account.create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
