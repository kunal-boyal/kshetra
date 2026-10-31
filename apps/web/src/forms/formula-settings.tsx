import { CALCULATED_RESULTS, describeFormula, parseFormula } from '@thelamp/forms';
import { SelectField, TextAreaField, TextField } from '@thelamp/ui-web';
import { useLanguage } from '../i18n';
import type { AnyFormField } from './drafts';

type Calculated = Extract<AnyFormField, { type: 'calculated' }>;

/** The fields a formula may read: earlier figures (decision D118). */
const FIGURES = new Set(['number', 'currency', 'calculated', 'product_lines']);

/**
 * A calculated field's settings (decision D118): the formula, the sentence it reads as while it is
 * typed, the earlier fields it may use, and what it holds: a number with its places and unit, or
 * an amount. The server checks it again on publish.
 */
export function FormulaSettings({
  field,
  earlier,
  set,
  unset,
}: {
  field: Calculated;
  earlier: readonly AnyFormField[];
  set: (patch: Record<string, unknown>) => void;
  unset: (key: string) => void;
}) {
  const { t, locale } = useLanguage();
  const figures = earlier.filter((entry) => FIGURES.has(entry.type));
  const labels = new Map(
    earlier.map((entry) => [
      entry.key,
      'label' in entry ? entry.label[locale] || entry.label.en || entry.key : entry.key,
    ]),
  );
  const parsed = field.formula.trim() ? parseFormula(field.formula) : null;
  const sentence =
    parsed && 'tree' in parsed
      ? describeFormula(
          parsed.tree,
          (key) => labels.get(key) ?? key,
          (phrase, parts) =>
            phrase === 'round'
              ? t('formula.say_round', { ...parts, count: Number(parts.places) })
              : t(`formula.say_${phrase}`, parts),
        )
      : null;
  return (
    <div className="flex flex-col gap-4">
      <TextAreaField
        label={t('builder.formula')}
        help={t('builder.formula_help')}
        rows={2}
        className="font-mono"
        value={field.formula}
        onChange={(event) => set({ formula: event.target.value })}
      />
      <p className="ks-meta" aria-live="polite">
        {sentence
          ? t('builder.formula_reads', { sentence })
          : parsed && 'problem' in parsed
            ? t('builder.formula_unreadable', { at: parsed.problem.at + 1 })
            : null}
      </p>
      <p className="ks-meta">
        {figures.length > 0
          ? t('builder.formula_fields', {
              fields: figures.map((entry) => `${entry.key} (${labels.get(entry.key)})`).join(', '),
            })
          : t('builder.formula_no_fields')}
      </p>
      <div className="grid gap-4 @2xl:grid-cols-3">
        <SelectField
          label={t('builder.result')}
          value={field.result}
          options={CALCULATED_RESULTS.map((result) => ({
            value: result,
            label: t(`builder.result_${result}`),
          }))}
          onChange={(event) =>
            set({
              result: event.target.value,
              ...(event.target.value === 'currency' ? { decimals: 2 } : {}),
            })
          }
        />
        {field.result === 'number' ? (
          <TextField
            label={t('builder.decimals')}
            inputMode="numeric"
            numeric
            value={String(field.decimals)}
            onChange={(event) => {
              const places = Number(event.target.value);
              if (event.target.value.trim() && Number.isInteger(places)) set({ decimals: places });
            }}
          />
        ) : null}
      </div>
      {field.result === 'number' ? (
        <div className="grid gap-4 @2xl:grid-cols-3">
          <TextField
            label={t('builder.unit_en')}
            value={field.unit?.en ?? ''}
            onChange={(event) =>
              event.target.value || field.unit?.hi
                ? set({ unit: { en: event.target.value, hi: field.unit?.hi ?? '' } })
                : unset('unit')
            }
          />
          <TextField
            label={t('builder.unit_hi')}
            lang="hi"
            value={field.unit?.hi ?? ''}
            onChange={(event) =>
              event.target.value || field.unit?.en
                ? set({ unit: { en: field.unit?.en ?? '', hi: event.target.value } })
                : unset('unit')
            }
          />
        </div>
      ) : null}
    </div>
  );
}
