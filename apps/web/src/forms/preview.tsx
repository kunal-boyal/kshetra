import {
  conditionHolds,
  type FormDefinition,
  signatureRequired,
  type Values,
  VISIT_ORDERED,
} from '@thelamp/forms';
import { type MessageKey, translate } from '@thelamp/i18n';
import type { Locale } from '@thelamp/shared';
import { Checkbox, ChoiceGroup, SelectField, TextAreaField, TextField } from '@thelamp/ui-web';
import { useId, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import type { AnyFormField } from './drafts';

type Say = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

/** Text as the phone says it: in the preview's language, with the tenant's own words. */
function usePhoneText(locale: Locale): Say {
  const { client, queryClient } = useApp();
  const terms = useConfig(client, queryClient).data?.bundle.terminology[locale];
  return (key, params) =>
    translate(key, { locale, ...(params ? { params } : {}), ...(terms ? { terms } : {}) });
}

/**
 * The form as a phone shows it (spec 8.2 form builder): its fields in order, in either language,
 * shown as their conditions say. Answers typed here only try the conditions; nothing is kept.
 * Photos, scans, pickers and item lines show as the controls the phone offers.
 */
export function PhonePreview({ form }: { form: FormDefinition }) {
  const { t } = useLanguage();
  const [locale, setLocale] = useState<Locale>('en');
  const [values, setValues] = useState<Values>({});
  // In a visit, whether it took an order, which conditions may ask (decision D97).
  const [ordered, setOrdered] = useState(false);
  const facts: Values = form.visitSession ? { [VISIT_ORDERED]: ordered } : {};
  const say = usePhoneText(locale);
  const headingId = useId();
  return (
    <section className="ks-card ks-phone flex flex-col gap-4" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="heading-md">
          {t('builder.preview')}
        </h2>
        <SelectField
          label={t('builder.preview_language')}
          value={locale}
          options={[
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'हिन्दी' },
          ]}
          onChange={(event) => setLocale(event.target.value as Locale)}
        />
      </div>
      <p className="ks-muted">{t('builder.preview_help')}</p>
      {form.visitSession ? (
        <Checkbox
          label={t('builder.visit_ordered')}
          checked={ordered}
          onChange={(event) => setOrdered(event.target.checked)}
        />
      ) : null}
      <div className="flex flex-col gap-4" lang={locale}>
        <p className="heading-lg">{form.name[locale].one || form.name.en.one || '—'}</p>
        {form.accountLink.mode !== 'none' ? (
          <Placeholder
            label={`${say('builder.preview_account')}${form.accountLink.mode === 'required' ? ' *' : ''}`}
            note={say('builder.preview_pick')}
          />
        ) : null}
        <PreviewFields
          fields={form.fields}
          values={values}
          onChange={setValues}
          locale={locale}
          say={say}
          outer={facts}
        />
        {form.photos ? (
          <Placeholder
            label={`${say('builder.preview_photos_label')}${form.photos.min > 0 ? ' *' : ''}`}
            note={say('builder.preview_photos', { min: form.photos.min, max: form.photos.max })}
          />
        ) : null}
        {form.signature !== 'none' ? (
          <Placeholder
            label={`${say('builder.signature')}${signatureRequired(form, values, form.visitSession ? { visitOrdered: ordered } : {}) ? ' *' : ''}`}
            note={say('builder.preview_signature')}
          />
        ) : null}
      </div>
    </section>
  );
}

/** A control the browser can't stand in for, such as the camera. */
function Placeholder({ label, note }: { label: string; note: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="ks-label">{label}</span>
      <span className="ks-notice">{note}</span>
    </div>
  );
}

/** The fields shown: a hidden section hides those under it, as the phone and the server judge. */
function shownFields(fields: readonly AnyFormField[], seen: Values): AnyFormField[] {
  const shown: AnyFormField[] = [];
  let sectionShown = true;
  for (const field of fields) {
    if (field.type === 'section') {
      sectionShown = !field.visibleWhen || conditionHolds(field.visibleWhen, seen);
      if (sectionShown) shown.push(field);
    } else if (sectionShown && (!field.visibleWhen || conditionHolds(field.visibleWhen, seen))) {
      shown.push(field);
    }
  }
  return shown;
}

const textOf = (value: unknown) => (typeof value === 'string' ? value : '');

function PreviewFields({
  fields,
  values,
  onChange,
  locale,
  say,
  outer = {},
}: {
  fields: readonly AnyFormField[];
  values: Values;
  onChange: (values: Values) => void;
  locale: Locale;
  say: Say;
  outer?: Values;
}) {
  const seen = { ...outer, ...values };
  const set = (key: string, value: unknown) => {
    const next = { ...values };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return (
    <>
      {shownFields(fields, seen).map((field, index) => {
        if (field.type === 'section') {
          return (
            <p key={`${index}-${field.key}`} className="heading-md">
              {field.label[locale] || field.label.en}
            </p>
          );
        }
        const key = `${index}-${field.key}`;
        if (field.type === 'info_text') {
          return (
            <p key={key} className="ks-notice">
              {field.text[locale] || field.text.en}
            </p>
          );
        }
        const label = `${field.label[locale] || field.label.en || field.key}${field.required ? ' *' : ''}`;
        const help = field.help ? field.help[locale] || field.help.en : undefined;
        const value = values[field.key];
        switch (field.type) {
          case 'short_text':
          case 'number':
          case 'currency':
          case 'date':
          case 'time':
          case 'barcode':
            return (
              <TextField
                key={key}
                label={label}
                {...(help ? { help } : {})}
                inputMode={
                  field.type === 'number' || field.type === 'currency' ? 'decimal' : 'text'
                }
                placeholder={
                  field.type === 'date' ? 'YYYY-MM-DD' : field.type === 'time' ? 'HH:MM' : undefined
                }
                value={value === undefined ? '' : String(value)}
                onChange={(event) => {
                  const raw = event.target.value;
                  set(
                    field.key,
                    field.type === 'number' && /^-?\d+(\.\d+)?$/.test(raw.trim())
                      ? Number(raw)
                      : raw,
                  );
                }}
              />
            );
          case 'long_text':
            return (
              <TextAreaField
                key={key}
                label={label}
                {...(help ? { help } : {})}
                rows={3}
                value={textOf(value)}
                onChange={(event) => set(field.key, event.target.value)}
              />
            );
          case 'yes_no':
            return (
              <SelectField
                key={key}
                label={label}
                value={value === true ? 'yes' : value === false ? 'no' : ''}
                none="—"
                options={[
                  { value: 'yes', label: say('common.yes') },
                  { value: 'no', label: say('common.no') },
                ]}
                onChange={(event) =>
                  set(
                    field.key,
                    event.target.value === '' ? undefined : event.target.value === 'yes',
                  )
                }
              />
            );
          case 'single_select':
            return field.options ? (
              <SelectField
                key={key}
                label={label}
                value={textOf(value)}
                none="—"
                options={field.options.map((option) => ({
                  value: option.key,
                  label: option.label[locale] || option.label.en,
                }))}
                onChange={(event) => set(field.key, event.target.value)}
              />
            ) : (
              <Placeholder key={key} label={label} note={say('builder.preview_catalogue')} />
            );
          case 'multi_select': {
            if (!field.options) {
              return (
                <Placeholder key={key} label={label} note={say('builder.preview_catalogue')} />
              );
            }
            const chosen = Array.isArray(value) ? (value as string[]) : [];
            return (
              <ChoiceGroup key={key} legend={label}>
                {field.options.map((option) => (
                  <Checkbox
                    key={option.key}
                    label={option.label[locale] || option.label.en}
                    checked={chosen.includes(option.key)}
                    onChange={(event) =>
                      set(
                        field.key,
                        event.target.checked
                          ? [...chosen, option.key]
                          : chosen.filter((entry) => entry !== option.key),
                      )
                    }
                  />
                ))}
              </ChoiceGroup>
            );
          }
          case 'rating':
            return (
              <SelectField
                key={key}
                label={label}
                value={typeof value === 'number' ? String(value) : ''}
                none="—"
                options={[1, 2, 3, 4, 5].map((stars) => ({
                  value: String(stars),
                  label: say('builder.preview_stars', { count: stars }),
                }))}
                onChange={(event) =>
                  set(field.key, event.target.value ? Number(event.target.value) : undefined)
                }
              />
            );
          case 'photo':
            return <Placeholder key={key} label={label} note={say('builder.preview_camera')} />;
          case 'account_picker':
          case 'contact_picker':
            return <Placeholder key={key} label={label} note={say('builder.preview_pick')} />;
          case 'product_lines':
            return (
              <Placeholder
                key={key}
                label={label}
                note={say(
                  field.quantities === false
                    ? 'builder.preview_lines_plain'
                    : 'builder.preview_lines',
                )}
              />
            );
          case 'repeating_group':
            return (
              <fieldset
                key={key}
                className="flex flex-col gap-3 border-l-4 border-[var(--border)] pl-3"
              >
                <legend className="ks-label">{label}</legend>
                <PreviewFields
                  fields={field.fields}
                  values={
                    (Array.isArray(value) ? (value[0] as Values | undefined) : undefined) ?? {}
                  }
                  onChange={(entry) => set(field.key, [entry])}
                  locale={locale}
                  say={say}
                  outer={seen}
                />
                <span className="ks-muted">
                  {say('builder.preview_group', { count: field.maxItems })}
                </span>
              </fieldset>
            );
        }
      })}
    </>
  );
}
