import type { FormDefinition, FormField, GroupItemField } from '@kshetra/forms';
import type { ErrorDetail } from '@kshetra/shared';

export type AnyFormField = FormField | GroupItemField;
export type FieldType = FormField['type'];

/** Every field type of version 1, in the order the builder offers them (spec 5.6). */
export const FIELD_TYPES: readonly FieldType[] = [
  'short_text',
  'long_text',
  'number',
  'currency',
  'date',
  'time',
  'single_select',
  'multi_select',
  'yes_no',
  'rating',
  'photo',
  'barcode',
  'account_picker',
  'contact_picker',
  'product_lines',
  'repeating_group',
  'section',
  'info_text',
];

/** What a repeating group may hold: anything but a section or another group. */
export const GROUP_ITEM_TYPES = FIELD_TYPES.filter(
  (type) => type !== 'section' && type !== 'repeating_group',
);

const blank = { en: '', hi: '' };

/** A new field of a type, with a key no other field has. */
export function newField(type: FieldType, taken: ReadonlySet<string>): AnyFormField {
  let n = taken.size + 1;
  while (taken.has(`field_${n}`)) n += 1;
  const key = `field_${n}`;
  const value = { key, label: { ...blank }, required: false };
  switch (type) {
    case 'section':
      return { key, type, label: { ...blank } };
    case 'info_text':
      return { key, type, text: { ...blank } };
    case 'short_text':
      return { ...value, type, maxLength: 200 };
    case 'long_text':
      return { ...value, type, maxLength: 2000 };
    case 'number':
      return { ...value, type, decimals: 0 };
    case 'single_select':
    case 'multi_select':
      // The builder asks for the options; a form can't publish without them.
      return { ...value, type, options: [] };
    case 'photo':
      return { ...value, type, source: 'camera' };
    case 'account_picker':
      return { ...value, type, accountTypes: [] };
    case 'product_lines':
      return { ...value, type, maxLines: 50 };
    case 'repeating_group':
      return {
        ...value,
        type,
        maxItems: 20,
        fields: [
          {
            key: `${key}_name`,
            type: 'short_text',
            label: { ...blank },
            required: false,
            maxLength: 200,
          },
        ],
      } as AnyFormField;
    default:
      return { ...value, type } as AnyFormField;
  }
}

/** Every key a list of fields uses, those inside groups included. */
export function keysOf(fields: readonly AnyFormField[]): Set<string> {
  const keys = new Set<string>();
  for (const field of fields) {
    keys.add(field.key);
    if (field.type === 'repeating_group') for (const key of keysOf(field.fields)) keys.add(key);
  }
  return keys;
}

/** Options as the builder writes them: one per line, `key | English | Hindi`. */
export function optionsText(
  options: readonly { key: string; label: { en: string; hi: string } }[],
) {
  return options
    .map((option) => `${option.key} | ${option.label.en} | ${option.label.hi}`)
    .join('\n');
}

export function parseOptions(text: string) {
  return text
    .split('\n')
    .map((line) => line.split('|').map((part) => part.trim()))
    .filter((parts) => parts[0])
    .map(([key, en = '', hi = '']) => ({
      key: key!,
      label: { en: en || key!, hi: hi || en || key! },
    }));
}

/** A blank form for the builder to start from. */
export function newForm(): FormDefinition {
  return {
    key: '',
    name: { en: { one: '', other: '' }, hi: { one: '', other: '' } },
    icon: 'clipboard-list',
    tags: [],
    accountLink: { mode: 'none' },
    visitSession: false,
    shift: 'required',
    signature: 'none',
    geofence: 'inherit',
    review: 'manual',
    fields: [newField('short_text', new Set())] as FormField[],
  };
}

/** The problems under one path, such as `definition.fields[2]`, and those inside it. */
export function problemsAt(problems: readonly ErrorDetail[], prefix: string): ErrorDetail[] {
  return problems.filter(
    (problem) =>
      problem.path === prefix ||
      problem.path.startsWith(`${prefix}.`) ||
      problem.path.startsWith(`${prefix}[`),
  );
}

const filled = (text: { en: string; hi: string }) => ({
  en: text.en.trim(),
  hi: text.hi.trim() || text.en.trim(),
});

function tidyField(field: AnyFormField): AnyFormField {
  const next = { ...field } as Record<string, unknown> & AnyFormField;
  if ('label' in field) next.label = filled(field.label);
  if (field.type === 'info_text') next.text = filled(field.text);
  if ('help' in field && field.help) next.help = filled(field.help);
  if (field.type === 'product_lines' && field.valueColumn) {
    next.valueColumn = { label: filled(field.valueColumn.label) };
  }
  if (field.type === 'repeating_group') next.fields = field.fields.map(tidyField);
  return next;
}

/** Before publishing: text trimmed, and Hindi left blank takes the English. */
export function tidy(form: FormDefinition): FormDefinition {
  const noun = (en: string, hi: string) => hi.trim() || en.trim();
  return {
    ...form,
    key: form.key.trim(),
    name: {
      en: { one: form.name.en.one.trim(), other: form.name.en.other.trim() },
      hi: {
        one: noun(form.name.en.one, form.name.hi.one),
        other: noun(form.name.en.other, form.name.hi.other),
      },
    },
    ...(form.description ? { description: filled(form.description) } : {}),
    fields: form.fields.map(tidyField) as FormField[],
  };
}
