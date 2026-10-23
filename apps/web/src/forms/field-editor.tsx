import { type AnyField, type Condition, operatorsFor } from '@thelamp/forms';
import { type ErrorDetail, type Locale, newId } from '@thelamp/shared';
import {
  Button,
  Checkbox,
  ChoiceGroup,
  Icon,
  SelectField,
  TextAreaField,
  TextField,
} from '@thelamp/ui-web';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useLanguage } from '../i18n';
import {
  type AnyFormField,
  FIELD_TYPES,
  type FieldType,
  keysOf,
  newField,
  optionsText,
  parseOptions,
  problemsAt,
} from './drafts';

type Translate = ReturnType<typeof useLanguage>['t'];

/** What the field editor needs from the form around it. */
export interface EditorContext {
  accountTypes: readonly { key: string; name: string }[];
  problems: readonly ErrorDetail[];
  /** Every key the form uses, so new fields get fresh ones. */
  taken: ReadonlySet<string>;
  /** Keys a published version used: they stay, since a key is how submissions read. */
  locked: ReadonlySet<string>;
}

const numberOrUndefined = (text: string) =>
  text.trim() === '' || !Number.isFinite(Number(text)) ? undefined : Number(text);

/** A field's name in the list: its label, else its key. */
function title(field: AnyFormField, locale: Locale): string {
  if (field.type === 'info_text') return field.text[locale] || field.text.en || field.key;
  return field.label[locale] || field.label.en || field.key;
}

/** A list of fields, in order, each with its editor (spec 5.6). */
export function FieldList({
  fields,
  onChange,
  types = FIELD_TYPES,
  context,
  path,
  outer = [],
}: {
  fields: readonly AnyFormField[];
  onChange: (fields: AnyFormField[]) => void;
  types?: readonly FieldType[];
  context: EditorContext;
  /** Where these fields sit in the definition, such as `definition.fields`. */
  path: string;
  /** Fields before a group, which a condition inside it may refer to. */
  outer?: readonly AnyFormField[];
}) {
  const { t } = useLanguage();
  // Each field's place in the editor, kept apart from its key, which the admin may be typing.
  const [ids, setIds] = useState(() => fields.map(() => newId()));
  const idAt = (index: number) => ids[index] ?? `${index}`;
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<FieldType>(types[0]!);
  const moved = <T,>(list: readonly T[], index: number, by: -1 | 1) => {
    const next = [...list];
    const [entry] = next.splice(index, 1);
    next.splice(index + by, 0, entry!);
    return next;
  };
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {fields.map((field, index) => {
          const at = `${path}[${index}]`;
          const problems = problemsAt(context.problems, at);
          const id = idAt(index);
          const shown = open === id || problems.length > 0;
          return (
            <li key={id}>
              <FieldCard
                field={field}
                index={index}
                count={fields.length}
                shown={shown}
                problems={problems}
                onToggle={() => setOpen(open === id ? null : id)}
                onMove={(by) => {
                  setIds(moved(ids, index, by));
                  onChange(moved(fields, index, by));
                }}
                onRemove={() => {
                  setIds(ids.filter((_, i) => i !== index));
                  onChange(fields.filter((_, i) => i !== index));
                }}
                onChange={(next) =>
                  onChange(fields.map((entry, i) => (i === index ? next : entry)))
                }
                context={context}
                path={at}
                earlier={[...outer, ...fields.slice(0, index)]}
              />
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <SelectField
          label={t('builder.add_type')}
          value={adding}
          options={types.map((type) => ({ value: type, label: t(`builder.type_${type}`) }))}
          onChange={(event) => setAdding(event.target.value as FieldType)}
        />
        <Button
          type="button"
          variant="secondary"
          icon={<Icon icon={Plus} />}
          onClick={() => {
            const id = newId();
            setIds([...fields.map((_, index) => idAt(index)), id]);
            onChange([...fields, newField(adding, context.taken)]);
            setOpen(id);
          }}
        >
          {t('builder.add_field')}
        </Button>
      </div>
    </div>
  );
}

function FieldCard({
  field,
  index,
  count,
  shown,
  problems,
  onToggle,
  onMove,
  onRemove,
  onChange,
  context,
  path,
  earlier,
}: {
  field: AnyFormField;
  index: number;
  count: number;
  shown: boolean;
  problems: readonly ErrorDetail[];
  onToggle: () => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onChange: (field: AnyFormField) => void;
  context: EditorContext;
  path: string;
  earlier: readonly AnyFormField[];
}) {
  const { t, locale } = useLanguage();
  const name = title(field, locale);
  return (
    <section
      className="ks-card flex flex-col gap-3"
      aria-label={t('builder.field_named', { name })}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-semibold">
            {index + 1}. {name}
          </span>
          <span className="ks-muted">
            {t(`builder.type_${field.type}`)} · <code>{field.key}</code>
            {'required' in field && field.required ? ` · ${t('builder.required')}` : ''}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t('builder.move_up_named', { name })}
            disabled={index === 0}
            icon={<Icon icon={ArrowUp} size="sm" />}
            onClick={() => onMove(-1)}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t('builder.move_down_named', { name })}
            disabled={index === count - 1}
            icon={<Icon icon={ArrowDown} size="sm" />}
            onClick={() => onMove(1)}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={shown}
            icon={<Icon icon={shown ? ChevronUp : ChevronDown} size="sm" />}
            onClick={onToggle}
          >
            {t(shown ? 'builder.close' : 'common.edit')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t('builder.remove_named', { name })}
            icon={<Icon icon={Trash2} size="sm" />}
            onClick={onRemove}
          />
        </div>
      </div>
      {problems.length > 0 ? (
        <ul className="ks-help error" role="alert">
          {problems.map((problem) => (
            <li key={`${problem.path}:${problem.issue}`}>{problem.issue}</li>
          ))}
        </ul>
      ) : null}
      {shown ? (
        <FieldSettings
          field={field}
          onChange={onChange}
          context={context}
          path={path}
          earlier={earlier}
        />
      ) : null}
    </section>
  );
}

function FieldSettings({
  field,
  onChange,
  context,
  path,
  earlier,
}: {
  field: AnyFormField;
  onChange: (field: AnyFormField) => void;
  context: EditorContext;
  path: string;
  earlier: readonly AnyFormField[];
}) {
  const { t } = useLanguage();
  // Decided when the settings open, so a new field's key stays editable while it is typed.
  const [locked] = useState(() => context.locked.has(field.key));
  const set = (patch: Record<string, unknown>) => onChange({ ...field, ...patch } as AnyFormField);
  const unset = (key: string) => {
    const next = { ...field } as Record<string, unknown>;
    delete next[key];
    onChange(next as AnyFormField);
  };
  const number = (key: string, label: string) => (
    <TextField
      label={label}
      inputMode="decimal"
      numeric
      value={String((field as Record<string, unknown>)[key] ?? '')}
      onChange={(event) => {
        const value = numberOrUndefined(event.target.value);
        if (value === undefined) unset(key);
        else set({ [key]: value });
      }}
    />
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <TextField
          label={t('builder.key')}
          help={t(locked ? 'builder.key_kept' : 'builder.key_help')}
          readOnly={locked}
          value={field.key}
          onChange={(event) => set({ key: event.target.value.trim() })}
        />
        {field.type === 'info_text' ? (
          <>
            <TextAreaField
              label={t('builder.text_en')}
              rows={2}
              value={field.text.en}
              onChange={(event) => set({ text: { ...field.text, en: event.target.value } })}
            />
            <TextAreaField
              label={t('builder.text_hi')}
              rows={2}
              value={field.text.hi}
              onChange={(event) => set({ text: { ...field.text, hi: event.target.value } })}
            />
          </>
        ) : (
          <>
            <TextField
              label={t('builder.label_en')}
              value={field.label.en}
              onChange={(event) => set({ label: { ...field.label, en: event.target.value } })}
            />
            <TextField
              label={t('builder.label_hi')}
              lang="hi"
              value={field.label.hi}
              onChange={(event) => set({ label: { ...field.label, hi: event.target.value } })}
            />
          </>
        )}
      </div>
      {'required' in field ? (
        <div className="grid gap-4 md:grid-cols-3">
          <TextField
            label={t('builder.help_en')}
            value={field.help?.en ?? ''}
            onChange={(event) =>
              event.target.value || field.help?.hi
                ? set({ help: { en: event.target.value, hi: field.help?.hi ?? '' } })
                : unset('help')
            }
          />
          <TextField
            label={t('builder.help_hi')}
            lang="hi"
            value={field.help?.hi ?? ''}
            onChange={(event) =>
              event.target.value || field.help?.en
                ? set({ help: { en: field.help?.en ?? '', hi: event.target.value } })
                : unset('help')
            }
          />
          <Checkbox
            label={t(
              field.type === 'repeating_group' ? 'builder.required_group' : 'builder.required',
            )}
            checked={field.required}
            onChange={(event) => set({ required: event.target.checked })}
          />
        </div>
      ) : null}

      {field.type === 'short_text' || field.type === 'long_text' ? (
        <div className="grid gap-4 md:grid-cols-3">
          {number('minLength', t('builder.min_length'))}
          {number('maxLength', t('builder.max_length'))}
          {field.type === 'short_text' ? (
            <TextField
              label={t('builder.pattern')}
              help={t('builder.pattern_help')}
              value={field.pattern ?? ''}
              onChange={(event) =>
                event.target.value ? set({ pattern: event.target.value }) : unset('pattern')
              }
            />
          ) : null}
        </div>
      ) : null}
      {field.type === 'number' ? (
        <div className="grid gap-4 md:grid-cols-3">
          {number('min', t('builder.min'))}
          {number('max', t('builder.max'))}
          {number('decimals', t('builder.decimals'))}
        </div>
      ) : null}
      {field.type === 'currency' ? (
        <div className="grid gap-4 md:grid-cols-3">
          {(['min', 'max'] as const).map((key) => (
            <TextField
              key={key}
              label={t(`builder.${key}`)}
              inputMode="decimal"
              numeric
              value={field[key] ?? ''}
              onChange={(event) =>
                event.target.value ? set({ [key]: event.target.value }) : unset(key)
              }
            />
          ))}
        </div>
      ) : null}
      {field.type === 'date' ? (
        <div className="grid gap-4 md:grid-cols-3">
          {number('minDaysFromToday', t('builder.min_days'))}
          {number('maxDaysFromToday', t('builder.max_days'))}
        </div>
      ) : null}
      {field.type === 'single_select' || field.type === 'multi_select' ? (
        <div className="flex flex-col gap-4">
          <SelectField
            label={t('builder.options_from')}
            value={field.optionsFrom ?? ''}
            none={t('builder.options_own')}
            options={[
              { value: 'catalogue_products', label: t('builder.options_products') },
              { value: 'catalogue_items', label: t('builder.options_items') },
            ]}
            onChange={(event) =>
              event.target.value
                ? onChange({
                    ...field,
                    optionsFrom: event.target.value as 'catalogue_items',
                    options: undefined,
                  } as AnyFormField)
                : onChange({ ...field, optionsFrom: undefined, options: [] } as AnyFormField)
            }
          />
          {!field.optionsFrom ? (
            <OptionsEditor options={field.options ?? []} onChange={(options) => set({ options })} />
          ) : null}
          {field.type === 'multi_select' ? (
            <div className="grid gap-4 md:grid-cols-3">
              {number('minSelected', t('builder.min_selected'))}
              {number('maxSelected', t('builder.max_selected'))}
            </div>
          ) : null}
        </div>
      ) : null}
      {field.type === 'photo' ? (
        <SelectField
          label={t('builder.photo_source')}
          value={field.source}
          options={[
            { value: 'camera', label: t('builder.source_camera') },
            { value: 'camera_and_gallery', label: t('builder.source_gallery') },
          ]}
          onChange={(event) => set({ source: event.target.value })}
        />
      ) : null}
      {field.type === 'account_picker' ? (
        <ChoiceGroup legend={t('builder.account_types')}>
          {context.accountTypes.map((type) => (
            <Checkbox
              key={type.key}
              label={type.name}
              checked={field.accountTypes.includes(type.key)}
              onChange={(event) =>
                set({
                  accountTypes: event.target.checked
                    ? [...field.accountTypes, type.key]
                    : field.accountTypes.filter((key) => key !== type.key),
                })
              }
            />
          ))}
        </ChoiceGroup>
      ) : null}
      {field.type === 'product_lines' ? (
        <div className="grid gap-4 md:grid-cols-3">
          {number('maxLines', t('builder.max_lines'))}
          <TextField
            label={t('builder.value_column_en')}
            help={t('builder.value_column_help')}
            value={field.valueColumn?.label.en ?? ''}
            onChange={(event) =>
              event.target.value
                ? set({
                    valueColumn: {
                      label: { en: event.target.value, hi: field.valueColumn?.label.hi ?? '' },
                    },
                  })
                : unset('valueColumn')
            }
          />
          {field.valueColumn ? (
            <TextField
              label={t('builder.value_column_hi')}
              lang="hi"
              value={field.valueColumn.label.hi}
              onChange={(event) =>
                set({
                  valueColumn: { label: { ...field.valueColumn!.label, hi: event.target.value } },
                })
              }
            />
          ) : null}
        </div>
      ) : null}
      {field.type === 'repeating_group' ? (
        <div className="flex flex-col gap-3">
          <div className="grid gap-4 md:grid-cols-3">
            {number('maxItems', t('builder.max_items'))}
          </div>
          <h3 className="heading-md">{t('builder.group_fields')}</h3>
          <FieldList
            fields={field.fields}
            onChange={(fields) => set({ fields })}
            types={FIELD_TYPES.filter((type) => type !== 'section' && type !== 'repeating_group')}
            context={{ ...context, taken: new Set([...context.taken, ...keysOf(field.fields)]) }}
            path={`${path}.fields`}
            outer={earlier}
          />
        </div>
      ) : null}

      <ConditionEditor
        condition={field.visibleWhen}
        earlier={earlier}
        onChange={(visibleWhen) => (visibleWhen ? set({ visibleWhen }) : unset('visibleWhen'))}
      />
    </div>
  );
}

/** Options, one per line: `key | English | Hindi`. */
function OptionsEditor({
  options,
  onChange,
}: {
  options: readonly { key: string; label: { en: string; hi: string } }[];
  onChange: (options: { key: string; label: { en: string; hi: string } }[]) => void;
}) {
  const { t } = useLanguage();
  const [text, setText] = useState(() => optionsText(options));
  return (
    <TextAreaField
      label={t('builder.options')}
      help={t('builder.options_help')}
      rows={Math.max(3, Math.min(10, options.length + 1))}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseOptions(event.target.value));
      }}
    />
  );
}

/** Values a clause can compare with: a field's own options, yes or no, or what is typed. */
function ClauseValue({
  field,
  op,
  value,
  onChange,
  t,
}: {
  field: AnyField | undefined;
  op: string;
  value: unknown;
  onChange: (value: unknown) => void;
  t: Translate;
}) {
  if (!field || op === 'is_empty' || op === 'is_not_empty') return null;
  if (field.type === 'yes_no') {
    return (
      <SelectField
        label={t('builder.clause_value')}
        value={value === true ? 'yes' : value === false ? 'no' : ''}
        none="—"
        options={[
          { value: 'yes', label: t('common.yes') },
          { value: 'no', label: t('common.no') },
        ]}
        onChange={(event) => onChange(event.target.value === 'yes')}
      />
    );
  }
  if ((field.type === 'single_select' || field.type === 'multi_select') && field.options) {
    if (op === 'in' || op === 'not_in') {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <ChoiceGroup legend={t('builder.clause_value')}>
          {field.options.map((option) => (
            <Checkbox
              key={option.key}
              label={option.label.en}
              checked={chosen.includes(option.key)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...chosen, option.key]
                    : chosen.filter((key) => key !== option.key),
                )
              }
            />
          ))}
        </ChoiceGroup>
      );
    }
    return (
      <SelectField
        label={t('builder.clause_value')}
        value={typeof value === 'string' ? value : ''}
        none="—"
        options={field.options.map((option) => ({ value: option.key, label: option.label.en }))}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <TextField
      label={t('builder.clause_value')}
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(event) =>
        onChange(
          field.type === 'number' ? numberOrUndefined(event.target.value) : event.target.value,
        )
      }
    />
  );
}

/** "Show when …": clauses on earlier fields, all or any of which must hold (spec 5.6). */
export function ConditionEditor({
  condition,
  earlier,
  onChange,
}: {
  condition: Condition | undefined;
  earlier: readonly AnyFormField[];
  onChange: (condition: Condition | undefined) => void;
}) {
  const { t, locale } = useLanguage();
  const groupId = useId();
  const usable = earlier.filter(
    (field): field is Exclude<AnyFormField, { type: 'section' } | { type: 'info_text' }> =>
      field.type !== 'section' &&
      field.type !== 'info_text' &&
      field.type !== 'repeating_group' &&
      operatorsFor(field).length > 0,
  );
  if (!condition) {
    return usable.length === 0 ? null : (
      <div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          icon={<Icon icon={Plus} size="sm" />}
          onClick={() =>
            onChange({
              match: 'all',
              clauses: [{ field: usable.at(-1)!.key, op: operatorsFor(usable.at(-1)!)[0]! }],
            })
          }
        >
          {t('builder.add_condition')}
        </Button>
      </div>
    );
  }
  const update = (index: number, patch: Record<string, unknown>) =>
    onChange({
      ...condition,
      clauses: condition.clauses.map((clause, i) =>
        i === index ? { ...clause, ...patch } : clause,
      ),
    } as Condition);
  return (
    <fieldset className="flex flex-col gap-3" aria-labelledby={groupId}>
      <legend id={groupId} className="font-semibold">
        {t('builder.show_when')}
      </legend>
      <SelectField
        label={t('builder.match')}
        value={condition.match}
        options={[
          { value: 'all', label: t('builder.match_all') },
          { value: 'any', label: t('builder.match_any') },
        ]}
        onChange={(event) => onChange({ ...condition, match: event.target.value as 'all' | 'any' })}
      />
      {condition.clauses.map((clause, index) => {
        const target = usable.find((field) => field.key === clause.field);
        return (
          <div key={index} className="grid items-end gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
            <SelectField
              label={t('builder.clause_field')}
              value={clause.field}
              options={usable.map((field) => ({ value: field.key, label: title(field, locale) }))}
              onChange={(event) => {
                const next = usable.find((field) => field.key === event.target.value)!;
                update(index, { field: next.key, op: operatorsFor(next)[0], value: undefined });
              }}
            />
            <SelectField
              label={t('builder.clause_op')}
              value={clause.op}
              options={(target ? operatorsFor(target) : []).map((op) => ({
                value: op,
                label: t(`builder.op_${op}`),
              }))}
              onChange={(event) => update(index, { op: event.target.value, value: undefined })}
            />
            <ClauseValue
              field={target}
              op={clause.op}
              value={clause.value}
              onChange={(value) => update(index, { value })}
              t={t}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('builder.remove_clause')}
              icon={<Icon icon={Trash2} size="sm" />}
              onClick={() =>
                condition.clauses.length === 1
                  ? onChange(undefined)
                  : onChange({
                      ...condition,
                      clauses: condition.clauses.filter((_, i) => i !== index),
                    } as Condition)
              }
            />
          </div>
        );
      })}
      <div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          icon={<Icon icon={Plus} size="sm" />}
          onClick={() =>
            onChange({
              ...condition,
              clauses: [
                ...condition.clauses,
                { field: usable[0]!.key, op: operatorsFor(usable[0]!)[0]! },
              ],
            } as Condition)
          }
        >
          {t('builder.add_clause')}
        </Button>
      </div>
    </fieldset>
  );
}
