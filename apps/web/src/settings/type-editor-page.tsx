import type { AccountType, AccountTypeView, Condition, CustomField } from '@kshetra/forms';
import { Button, Checkbox, Icon, SelectField, TextField } from '@kshetra/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Save, Trash2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { ConditionEditor } from '../forms/field-editor';
import type { AnyFormField } from '../forms/drafts';
import { errorMessage, useLanguage } from '../i18n';
import { useDesignations } from '../people/data';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { CustomFieldsEditor, draftOf, type FieldDraft, fieldOf } from './custom-fields-editor';
import { useSaveType, useTypeList } from './types-data';

interface SlotDraft {
  key: string;
  en: string;
  hi: string;
  designations: string[];
  required: boolean;
  priority: string;
}

interface SegmentDraft {
  segment: string;
  en: string;
  hi: string;
  when: Condition | undefined;
}

interface TypeDraft {
  key: string;
  oneEn: string;
  otherEn: string;
  oneHi: string;
  otherHi: string;
  icon: string;
  active: boolean;
  contacts: boolean;
  codeMode: 'manual' | 'auto';
  prefix: string;
  locationRequired: boolean;
  policy: 'off' | 'advisory' | 'required';
  radius: string;
  mayPropose: boolean;
  creation: 'admins' | 'field_users_with_approval';
  parentTypes: string[];
  slots: SlotDraft[];
  fields: FieldDraft[];
  segments: SegmentDraft[];
  norms: { segment: string; visits: string }[];
}

const POLICIES = ['off', 'advisory', 'required'] as const;
const CREATION = ['admins', 'field_users_with_approval'] as const;

function draftOfType(type: AccountTypeView | undefined): TypeDraft {
  return {
    key: type?.key ?? '',
    oneEn: type?.name.en.one ?? '',
    otherEn: type?.name.en.other ?? '',
    oneHi: type?.name.hi.one ?? '',
    otherHi: type?.name.hi.other ?? '',
    icon: type?.icon ?? 'store',
    active: type?.active ?? true,
    contacts: type?.contacts ?? false,
    codeMode: type?.code.mode ?? 'manual',
    prefix: type?.code.mode === 'auto' ? type.code.prefix : '',
    locationRequired: type?.location.required ?? false,
    policy: type?.location.geofencePolicy ?? 'advisory',
    radius: type?.location.geofenceRadiusM ? String(type.location.geofenceRadiusM) : '',
    mayPropose: type?.location.fieldUsersMayPropose ?? true,
    creation: type?.creation ?? 'admins',
    parentTypes: [...(type?.parentTypes ?? [])],
    slots: (type?.slots ?? []).map((slot) => ({
      key: slot.key,
      en: slot.name.en,
      hi: slot.name.hi,
      designations: [...slot.designations],
      required: slot.required,
      priority: String(slot.priority),
    })),
    fields: (type?.fields ?? []).map(draftOf),
    segments: (type?.segmentRules ?? []).map((rule) => ({
      segment: rule.segment,
      en: rule.name.en,
      hi: rule.name.hi,
      when: rule.when,
    })),
    norms: (type?.visitFrequencyNorms ?? []).map((norm) => ({
      segment: norm.segment,
      visits: String(norm.visitsPerMonth),
    })),
  };
}

/** The definition the API checks; the server says what is wrong, field by field. */
function definitionOf(draft: TypeDraft): AccountType {
  const both = (en: string, hi: string) => ({ en: en.trim(), hi: hi.trim() || en.trim() });
  return {
    key: draft.key.trim(),
    name: {
      en: { one: draft.oneEn.trim(), other: draft.otherEn.trim() },
      hi: {
        one: draft.oneHi.trim() || draft.oneEn.trim(),
        other: draft.otherHi.trim() || draft.otherEn.trim(),
      },
    },
    icon: draft.icon.trim(),
    active: draft.active,
    parentTypes: draft.parentTypes,
    code:
      draft.codeMode === 'auto'
        ? { mode: 'auto', prefix: draft.prefix.trim() }
        : { mode: 'manual' },
    fields: draft.fields.map(fieldOf) as CustomField[],
    location: {
      required: draft.locationRequired,
      geofencePolicy: draft.policy,
      fieldUsersMayPropose: draft.mayPropose,
      ...(draft.radius.trim() ? { geofenceRadiusM: Number(draft.radius) } : {}),
    },
    creation: draft.creation,
    slots: draft.slots.map((slot) => ({
      key: slot.key.trim(),
      name: both(slot.en, slot.hi),
      designations: slot.designations,
      required: slot.required,
      priority: Number(slot.priority) || 1,
    })),
    // A segment without a rule goes as it is, so the API names what is missing.
    segmentRules: draft.segments.map((segment) => ({
      segment: segment.segment.trim(),
      name: both(segment.en, segment.hi),
      ...(segment.when ? { when: segment.when } : {}),
    })),
    visitFrequencyNorms: draft.norms.map((norm) => ({
      segment: norm.segment,
      visitsPerMonth: Number(norm.visits) || 1,
    })),
    contacts: draft.contacts,
  } as AccountType;
}

/**
 * One account type (M2, spec 5.5): its names, codes, location rules, who creates accounts, the
 * slots people fill, its fields, the segments its rules tag and how often each should be visited.
 * Saving adds the type or publishes its next version; a key never changes, nor a used field's type.
 */
export function TypeEditorPage({ typeId }: { typeId?: string }) {
  const { t } = useLanguage();
  const types = useTypeList();
  if (types.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(types.error, t)}
      </p>
    );
  }
  if (!types.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const type = typeId ? types.data.find((entry) => entry.id === typeId) : undefined;
  if (typeId && !type) return <p className="ks-muted">{t('types.not_found')}</p>;
  return (
    <Editor
      key={typeId ?? 'new'}
      type={type}
      others={types.data.filter((entry) => entry.id !== typeId)}
    />
  );
}

function Editor({
  type,
  others,
}: {
  type: AccountTypeView | undefined;
  others: readonly AccountTypeView[];
}) {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const designations = useDesignations();
  const save = useSaveType();
  const [draft, setDraft] = useState(() => draftOfType(type));
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const at = (path: string) =>
    errors[`definition.${path}`] ? { error: errors[`definition.${path}`] } : {};
  const set = (patch: Partial<TypeDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const known = new Set((type?.fields ?? []).map((field) => field.key));
  const segmentKeys = draft.segments.map((segment) => segment.segment).filter(Boolean);
  const earlier = draft.fields.map(fieldOf) as AnyFormField[];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await save(definitionOf(draft), type?.id);
      await navigate({ to: '/settings/account-types' });
    } catch (caught) {
      setFailure(caught);
      setBusy(false);
    }
  }

  const list = <T,>(items: T[], key: keyof TypeDraft) => ({
    change: (index: number, patch: Partial<T>) =>
      set({ [key]: items.map((item, at) => (at === index ? { ...item, ...patch } : item)) }),
    remove: (index: number) => set({ [key]: items.filter((_, at) => at !== index) }),
  });
  const slots = list(draft.slots, 'slots');
  const segments = list(draft.segments, 'segments');
  const norms = list(draft.norms, 'norms');
  const grid = (children: ReactNode) => <div className="grid gap-4 md:grid-cols-2">{children}</div>;

  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => void submit(event)} noValidate>
      <PageHeader
        title={type ? type.name[locale].other : t('types.add')}
        back={{ to: '/settings/account-types', label: t('types.title') }}
      />
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

      <Section title={t('types.names')}>
        {grid(
          <>
            <TextField
              label={t('types.key')}
              help={t('types.key_help')}
              required
              readOnly={type !== undefined}
              value={draft.key}
              {...at('key')}
              onChange={(event) => set({ key: event.target.value })}
            />
            <TextField
              label={t('types.icon')}
              help={t('types.icon_help')}
              value={draft.icon}
              {...at('icon')}
              onChange={(event) => set({ icon: event.target.value })}
            />
            <TextField
              label={t('types.one_en')}
              required
              value={draft.oneEn}
              {...at('name.en.one')}
              onChange={(event) => set({ oneEn: event.target.value })}
            />
            <TextField
              label={t('types.other_en')}
              required
              value={draft.otherEn}
              {...at('name.en.other')}
              onChange={(event) => set({ otherEn: event.target.value })}
            />
            <TextField
              label={t('types.one_hi')}
              value={draft.oneHi}
              onChange={(event) => set({ oneHi: event.target.value })}
            />
            <TextField
              label={t('types.other_hi')}
              value={draft.otherHi}
              onChange={(event) => set({ otherHi: event.target.value })}
            />
          </>,
        )}
        <Checkbox
          label={t('types.active')}
          checked={draft.active}
          onChange={(event) => set({ active: event.target.checked })}
        />
        <Checkbox
          label={t('types.contacts')}
          checked={draft.contacts}
          onChange={(event) => set({ contacts: event.target.checked })}
        />
      </Section>

      <Section title={t('types.rules')}>
        {grid(
          <>
            <SelectField
              label={t('types.code_mode')}
              value={draft.codeMode}
              options={[
                { value: 'manual', label: t('types.code_manual') },
                { value: 'auto', label: t('types.code_auto') },
              ]}
              onChange={(event) => set({ codeMode: event.target.value as TypeDraft['codeMode'] })}
            />
            {draft.codeMode === 'auto' ? (
              <TextField
                label={t('types.prefix')}
                help={t('types.prefix_help')}
                value={draft.prefix}
                {...at('code.prefix')}
                onChange={(event) => set({ prefix: event.target.value.toUpperCase() })}
              />
            ) : (
              <span />
            )}
            <SelectField
              label={t('types.creation')}
              value={draft.creation}
              options={CREATION.map((value) => ({ value, label: t(`types.creation_${value}`) }))}
              onChange={(event) => set({ creation: event.target.value as TypeDraft['creation'] })}
            />
            <SelectField
              label={t('types.policy')}
              value={draft.policy}
              options={POLICIES.map((value) => ({ value, label: t(`types.policy_${value}`) }))}
              onChange={(event) => set({ policy: event.target.value as TypeDraft['policy'] })}
            />
            <TextField
              label={t('types.radius')}
              help={t('types.radius_help')}
              type="number"
              inputMode="numeric"
              value={draft.radius}
              {...at('location.geofenceRadiusM')}
              onChange={(event) => set({ radius: event.target.value })}
            />
          </>,
        )}
        <Checkbox
          label={t('types.location_required')}
          checked={draft.locationRequired}
          onChange={(event) => set({ locationRequired: event.target.checked })}
        />
        <Checkbox
          label={t('types.may_propose')}
          checked={draft.mayPropose}
          onChange={(event) => set({ mayPropose: event.target.checked })}
        />
        {others.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="ks-label">{t('types.parents')}</legend>
            {others.map((other) => (
              <Checkbox
                key={other.key}
                label={other.name[locale].other}
                checked={draft.parentTypes.includes(other.key)}
                onChange={(event) =>
                  set({
                    parentTypes: event.target.checked
                      ? [...draft.parentTypes, other.key]
                      : draft.parentTypes.filter((key) => key !== other.key),
                  })
                }
              />
            ))}
          </fieldset>
        ) : null}
      </Section>

      <Section title={t('types.slots')}>
        <p className="ks-muted text-sm">{t('types.slots_help')}</p>
        {draft.slots.map((slot, index) => (
          <fieldset key={index} className="ks-card flex flex-col gap-3">
            <legend className="sr-only">{slot.en || slot.key || t('types.slot_add')}</legend>
            {grid(
              <>
                <TextField
                  label={t('types.key')}
                  required
                  value={slot.key}
                  {...at(`slots[${index}].key`)}
                  onChange={(event) => slots.change(index, { key: event.target.value })}
                />
                <TextField
                  label={t('types.priority')}
                  help={t('types.priority_help')}
                  type="number"
                  value={slot.priority}
                  onChange={(event) => slots.change(index, { priority: event.target.value })}
                />
                <TextField
                  label={t('fields.label_en')}
                  required
                  value={slot.en}
                  onChange={(event) => slots.change(index, { en: event.target.value })}
                />
                <TextField
                  label={t('fields.label_hi')}
                  value={slot.hi}
                  onChange={(event) => slots.change(index, { hi: event.target.value })}
                />
              </>,
            )}
            <fieldset className="flex flex-wrap gap-3">
              <legend className="ks-label">{t('types.slot_designations')}</legend>
              {(designations.data ?? []).map((designation) => (
                <Checkbox
                  key={designation.key}
                  label={designation.name[locale].one}
                  checked={slot.designations.includes(designation.key)}
                  onChange={(event) =>
                    slots.change(index, {
                      designations: event.target.checked
                        ? [...slot.designations, designation.key]
                        : slot.designations.filter((key) => key !== designation.key),
                    })
                  }
                />
              ))}
            </fieldset>
            <Checkbox
              label={t('types.slot_required')}
              checked={slot.required}
              onChange={(event) => slots.change(index, { required: event.target.checked })}
            />
            <div>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon icon={Trash2} size="sm" />}
                onClick={() => slots.remove(index)}
              >
                {t('common.remove')}
              </Button>
            </div>
          </fieldset>
        ))}
        <div>
          <Button
            icon={<Icon icon={Plus} />}
            onClick={() =>
              set({
                slots: [
                  ...draft.slots,
                  { key: '', en: '', hi: '', designations: [], required: false, priority: '1' },
                ],
              })
            }
          >
            {t('types.slot_add')}
          </Button>
        </div>
      </Section>

      <Section title={t('types.fields')}>
        <CustomFieldsEditor
          drafts={draft.fields}
          onChange={(fields) => set({ fields })}
          known={known}
          errors={errors}
          path="definition.fields"
          editable
        />
      </Section>

      <Section title={t('types.segments')}>
        <p className="ks-muted text-sm">{t('types.segments_help')}</p>
        {draft.segments.map((segment, index) => (
          <fieldset key={index} className="ks-card flex flex-col gap-3">
            <legend className="sr-only">
              {segment.en || segment.segment || t('types.segment_add')}
            </legend>
            {grid(
              <>
                <TextField
                  label={t('types.key')}
                  required
                  value={segment.segment}
                  {...at(`segmentRules[${index}].segment`)}
                  onChange={(event) => segments.change(index, { segment: event.target.value })}
                />
                <span />
                <TextField
                  label={t('fields.label_en')}
                  required
                  value={segment.en}
                  onChange={(event) => segments.change(index, { en: event.target.value })}
                />
                <TextField
                  label={t('fields.label_hi')}
                  value={segment.hi}
                  onChange={(event) => segments.change(index, { hi: event.target.value })}
                />
              </>,
            )}
            {earlier.length > 0 ? (
              <ConditionEditor
                condition={segment.when}
                earlier={earlier}
                onChange={(when) => segments.change(index, { when })}
              />
            ) : (
              <p className="ks-muted text-sm">{t('types.segment_needs_fields')}</p>
            )}
            <div>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon icon={Trash2} size="sm" />}
                onClick={() => segments.remove(index)}
              >
                {t('common.remove')}
              </Button>
            </div>
          </fieldset>
        ))}
        <div>
          <Button
            icon={<Icon icon={Plus} />}
            onClick={() =>
              set({
                segments: [...draft.segments, { segment: '', en: '', hi: '', when: undefined }],
              })
            }
          >
            {t('types.segment_add')}
          </Button>
        </div>
        {segmentKeys.length > 0 ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="ks-label">{t('types.norms')}</legend>
            {draft.norms.map((norm, index) => (
              <div key={index} className="flex flex-wrap items-end gap-3">
                <SelectField
                  label={t('types.norm_segment')}
                  value={norm.segment}
                  options={segmentKeys.map((key) => ({ value: key, label: key }))}
                  onChange={(event) => norms.change(index, { segment: event.target.value })}
                />
                <TextField
                  label={t('types.norm_visits')}
                  type="number"
                  value={norm.visits}
                  {...at(`visitFrequencyNorms[${index}].visitsPerMonth`)}
                  onChange={(event) => norms.change(index, { visits: event.target.value })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Icon icon={Trash2} size="sm" />}
                  onClick={() => norms.remove(index)}
                >
                  {t('common.remove')}
                </Button>
              </div>
            ))}
            <div>
              <Button
                size="sm"
                icon={<Icon icon={Plus} size="sm" />}
                onClick={() =>
                  set({ norms: [...draft.norms, { segment: segmentKeys[0]!, visits: '4' }] })
                }
              >
                {t('types.norm_add')}
              </Button>
            </div>
          </fieldset>
        ) : null}
      </Section>

      <div>
        <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
          {type ? t('types.publish') : t('types.create')}
        </Button>
      </div>
    </form>
  );
}
