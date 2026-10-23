import { conditionHolds, type CustomField } from '@thelamp/forms';
import { Checkbox, ChoiceGroup, SelectField, TextAreaField, TextField } from '@thelamp/ui-web';
import { useLanguage } from '../i18n';

export type Values = Record<string, unknown>;

const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));

/**
 * Inputs for the tenant's custom user fields (spec 5.3), in order. A field whose condition doesn't
 * hold for the values so far is hidden, as the server would ignore it; the server checks again.
 */
export function CustomFieldInputs({
  fields,
  values,
  errors,
  onChange,
}: {
  fields: readonly CustomField[];
  values: Values;
  /** Problems by path, such as `custom.zone`. */
  errors: Record<string, string>;
  onChange: (key: string, value: unknown) => void;
}) {
  const { t, locale } = useLanguage();
  return (
    <>
      {fields.map((field) => {
        if (field.visibleWhen && !conditionHolds(field.visibleWhen, values)) return null;
        const common = {
          label: field.label[locale],
          required: field.required,
          ...(field.help ? { help: field.help[locale] } : {}),
          ...(errors[`custom.${field.key}`] ? { error: errors[`custom.${field.key}`] } : {}),
        };
        const value = values[field.key];
        switch (field.type) {
          case 'short_text':
            return (
              <TextField
                key={field.key}
                {...common}
                maxLength={field.maxLength}
                value={text(value)}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            );
          case 'long_text':
            return (
              <TextAreaField
                key={field.key}
                {...common}
                maxLength={field.maxLength}
                value={text(value)}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            );
          case 'number':
          case 'currency':
            return (
              <TextField
                key={field.key}
                {...common}
                numeric
                inputMode="decimal"
                value={text(value)}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            );
          case 'date':
            return (
              <TextField
                key={field.key}
                {...common}
                type="date"
                value={text(value)}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            );
          case 'single_select':
            return (
              <SelectField
                key={field.key}
                {...common}
                none="—"
                value={text(value)}
                options={(field.options ?? []).map((option) => ({
                  value: option.key,
                  label: option.label[locale],
                }))}
                onChange={(event) => onChange(field.key, event.target.value || null)}
              />
            );
          case 'multi_select': {
            const chosen = Array.isArray(value) ? (value as string[]) : [];
            return (
              <ChoiceGroup
                key={field.key}
                legend={common.label}
                {...(common.error ? { error: common.error } : {})}
              >
                {(field.options ?? []).map((option) => (
                  <Checkbox
                    key={option.key}
                    label={option.label[locale]}
                    checked={chosen.includes(option.key)}
                    onChange={(event) =>
                      onChange(
                        field.key,
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
          case 'yes_no':
            return (
              <SelectField
                key={field.key}
                {...common}
                none="—"
                value={value === true ? 'yes' : value === false ? 'no' : ''}
                options={[
                  { value: 'yes', label: t('common.yes') },
                  { value: 'no', label: t('common.no') },
                ]}
                onChange={(event) =>
                  onChange(
                    field.key,
                    event.target.value === '' ? null : event.target.value === 'yes',
                  )
                }
              />
            );
        }
      })}
    </>
  );
}

/** A custom value as the detail page shows it. */
export function customValue(
  field: CustomField,
  value: unknown,
  t: (key: 'common.yes' | 'common.no') => string,
  locale: 'en' | 'hi',
): string {
  if (value === undefined || value === null) return '—';
  switch (field.type) {
    case 'yes_no':
      return t(value ? 'common.yes' : 'common.no');
    case 'single_select':
      return field.options?.find((option) => option.key === value)?.label[locale] ?? String(value);
    case 'multi_select':
      return (Array.isArray(value) ? (value as string[]) : [])
        .map((key) => field.options?.find((option) => option.key === key)?.label[locale] ?? key)
        .join(', ');
    default:
      return String(value);
  }
}
