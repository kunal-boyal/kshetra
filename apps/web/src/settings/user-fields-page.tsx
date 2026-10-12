import { type CustomField, UserFieldsResult } from '@kshetra/forms';
import {
  Button,
  Checkbox,
  Icon,
  Notice,
  SelectField,
  TextAreaField,
  TextField,
} from '@kshetra/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, useUserFields, write } from '../people/data';
import { fieldErrors, PageHeader } from '../people/shared';

type FieldType = CustomField['type'];

const TYPES: readonly FieldType[] = [
  'short_text',
  'long_text',
  'number',
  'currency',
  'date',
  'single_select',
  'multi_select',
  'yes_no',
];

interface FieldDraft {
  /** The definition as stored, so settings this screen doesn't edit are kept. */
  original: CustomField | undefined;
  key: string;
  type: FieldType;
  en: string;
  hi: string;
  required: boolean;
  /** For choices: one per line, `key | English | Hindi`. */
  options: string;
}

function draftOf(field: CustomField): FieldDraft {
  const choices =
    field.type === 'single_select' || field.type === 'multi_select' ? (field.options ?? []) : [];
  return {
    original: field,
    key: field.key,
    type: field.type,
    en: field.label.en,
    hi: field.label.hi,
    required: field.required,
    options: choices
      .map((option) => `${option.key} | ${option.label.en} | ${option.label.hi}`)
      .join('\n'),
  };
}

function fieldOf(draft: FieldDraft): Record<string, unknown> {
  const kept = draft.original && draft.original.type === draft.type ? draft.original : {};
  const choice = draft.type === 'single_select' || draft.type === 'multi_select';
  return {
    ...kept,
    key: draft.key.trim(),
    type: draft.type,
    label: { en: draft.en.trim(), hi: draft.hi.trim() || draft.en.trim() },
    required: draft.required,
    ...(choice
      ? {
          options: draft.options
            .split('\n')
            .map((line) => line.split('|').map((part) => part.trim()))
            .filter(([key]) => key)
            .map(([key, en, hi]) => ({
              key,
              label: { en: en || key, hi: hi || en || key },
            })),
        }
      : {}),
  };
}

/**
 * The tenant's custom people fields (spec 5.3): what the organisation keeps about each person
 * beyond the standard details. A field left out retires, its key kept with its type.
 */
export function UserFieldsPage() {
  const { t } = useLanguage();
  const fields = useUserFields();
  if (fields.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  if (fields.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(fields.error, t)}
      </p>
    );
  }
  return <Editor fields={fields.data.fields} retired={fields.data.retired} />;
}

function Editor({
  fields,
  retired,
}: {
  fields: readonly CustomField[];
  retired: readonly CustomField[];
}) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState(() => fields.map(draftOf));
  const [failure, setFailure] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const editable = access.can('settings.manage');
  const known = new Set([...fields, ...retired].map((field) => field.key));

  const change = (index: number, patch: Partial<FieldDraft>) =>
    setDrafts((current) =>
      current.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)),
    );
  const move = (index: number, by: number) =>
    setDrafts((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setSaved(false);
    setBusy(true);
    try {
      await write(client, 'PUT', '/v1/user-fields', UserFieldsResult, {
        fields: drafts.map(fieldOf),
      });
      await queryClient.invalidateQueries({ queryKey: ['user-fields'] });
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const back = retired.filter((field) => !drafts.some((draft) => draft.key === field.key));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('fields.title')} intro={t('fields.intro')} />
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        {saved ? <Notice>{t('common.saved')}</Notice> : null}
        {failure ? (
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
        {drafts.length === 0 ? <p className="ks-muted">{t('fields.empty')}</p> : null}
        {drafts.map((draft, index) => {
          const at = (part: string) => errors[`fields[${index}].${part}`];
          const locked = draft.original !== undefined || known.has(draft.key.trim());
          return (
            <fieldset key={index} className="ks-card flex flex-col gap-3" disabled={!editable}>
              <legend className="sr-only">{draft.en || draft.key || t('fields.add')}</legend>
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  label={t('fields.key')}
                  help={t('fields.key_help')}
                  required
                  readOnly={draft.original !== undefined}
                  value={draft.key}
                  {...(at('key') ? { error: at('key') } : {})}
                  onChange={(event) => change(index, { key: event.target.value })}
                />
                <SelectField
                  label={t('fields.type')}
                  value={draft.type}
                  disabled={locked}
                  options={TYPES.map((type) => ({ value: type, label: t(`field_type.${type}`) }))}
                  {...(at('type') ? { error: at('type') } : {})}
                  onChange={(event) => change(index, { type: event.target.value as FieldType })}
                />
                <TextField
                  label={t('fields.label_en')}
                  required
                  value={draft.en}
                  {...(at('label.en') ? { error: at('label.en') } : {})}
                  onChange={(event) => change(index, { en: event.target.value })}
                />
                <TextField
                  label={t('fields.label_hi')}
                  value={draft.hi}
                  {...(at('label.hi') ? { error: at('label.hi') } : {})}
                  onChange={(event) => change(index, { hi: event.target.value })}
                />
              </div>
              {draft.type === 'single_select' || draft.type === 'multi_select' ? (
                <TextAreaField
                  label={t('fields.options')}
                  help={t('fields.options_help')}
                  value={draft.options}
                  {...(at('options') ? { error: at('options') } : {})}
                  onChange={(event) => change(index, { options: event.target.value })}
                />
              ) : null}
              <Checkbox
                label={t('fields.required')}
                checked={draft.required}
                onChange={(event) => change(index, { required: event.target.checked })}
              />
              {editable ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === 0}
                    icon={<Icon icon={ArrowUp} size="sm" />}
                    onClick={() => move(index, -1)}
                  >
                    {t('common.move_up')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === drafts.length - 1}
                    icon={<Icon icon={ArrowDown} size="sm" />}
                    onClick={() => move(index, 1)}
                  >
                    {t('common.move_down')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Icon icon={Trash2} size="sm" />}
                    onClick={() => setDrafts(drafts.filter((_, at) => at !== index))}
                  >
                    {t('common.remove')}
                  </Button>
                </div>
              ) : null}
            </fieldset>
          );
        })}
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<Icon icon={Plus} />}
              onClick={() =>
                setDrafts([
                  ...drafts,
                  {
                    original: undefined,
                    key: '',
                    type: 'short_text',
                    en: '',
                    hi: '',
                    required: false,
                    options: '',
                  },
                ])
              }
            >
              {t('fields.add')}
            </Button>
            <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
              {t('fields.save')}
            </Button>
          </div>
        ) : null}
      </form>

      {back.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label={t('fields.retired')}>
          <h2 className="heading-md">{t('fields.retired')}</h2>
          <p className="ks-muted">{t('fields.retired_help')}</p>
          <ul className="flex flex-col gap-2">
            {back.map((field) => (
              <li key={field.key} className="flex flex-wrap items-center gap-3">
                <span>{field.label[locale]}</span>
                <code>{field.key}</code>
                <span className="ks-muted">{t(`field_type.${field.type}`)}</span>
                {editable ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Icon icon={Undo2} size="sm" />}
                    onClick={() => setDrafts([...drafts, draftOf(field)])}
                  >
                    {t('fields.add')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
