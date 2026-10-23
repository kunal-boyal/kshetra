import type { CustomField } from '@thelamp/forms';
import { Button, Checkbox, Icon, SelectField, TextAreaField, TextField } from '@thelamp/ui-web';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '../i18n';

/**
 * Custom fields (spec 5.3, 5.5): the fields people and account types keep beyond the standard
 * ones, edited as a list. A key keeps its type once it was used, so it is locked then.
 */

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

export interface FieldDraft {
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

export function draftOf(field: CustomField): FieldDraft {
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

export function fieldOf(draft: FieldDraft): Record<string, unknown> {
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

/** A new, empty field. */
export const newDraft = (): FieldDraft => ({
  original: undefined,
  key: '',
  type: 'short_text',
  en: '',
  hi: '',
  required: false,
  options: '',
});

/**
 * The fields, in order, each with its key, type, labels, choices and whether it must be filled.
 * `errors` holds the API's field errors under `path` (such as `fields` or `definition.fields`).
 */
export function CustomFieldsEditor({
  drafts,
  onChange,
  known,
  errors,
  path,
  editable,
}: {
  drafts: readonly FieldDraft[];
  onChange: (drafts: FieldDraft[]) => void;
  /** Keys any earlier version used: their type stays. */
  known: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  path: string;
  editable: boolean;
}) {
  const { t } = useLanguage();
  const change = (index: number, patch: Partial<FieldDraft>) =>
    onChange(drafts.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)));
  const move = (index: number, by: number) => {
    const next = [...drafts];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-4">
      {drafts.length === 0 ? <p className="ks-muted">{t('fields.empty')}</p> : null}
      {drafts.map((draft, index) => {
        const at = (part: string) => errors[`${path}[${index}].${part}`];
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
                  onClick={() => onChange(drafts.filter((_, at) => at !== index))}
                >
                  {t('common.remove')}
                </Button>
              </div>
            ) : null}
          </fieldset>
        );
      })}
      {editable ? (
        <div>
          <Button icon={<Icon icon={Plus} />} onClick={() => onChange([...drafts, newDraft()])}>
            {t('fields.add')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
