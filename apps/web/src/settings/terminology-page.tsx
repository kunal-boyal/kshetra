import { TERMINOLOGY_DEFAULTS } from '@kshetra/i18n';
import {
  LOCALES,
  type Locale,
  TERMINOLOGY_KEYS,
  type TerminologyKey,
  type TerminologyOverrides,
} from '@kshetra/shared';
import { Button, Icon, TextField } from '@kshetra/ui-web';
import { Save } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { useAdmin, useTerminology } from './data';

const KEYS = Object.keys(TERMINOLOGY_KEYS) as TerminologyKey[];

/** A term's key without its `term.` prefix, as its heading's message names it. */
type TermName = TerminologyKey extends `term.${infer Name}` ? Name : never;

type Noun = { one: string; other: string };
type Words = Partial<Record<TerminologyKey, Partial<Record<Locale, Noun | string>>>>;

/** The product's own word for a term, as the field's placeholder shows it. */
function productWord(key: TerminologyKey, code: Locale): Noun | string {
  return TERMINOLOGY_DEFAULTS[code][key] as Noun | string;
}

/** Only the words someone typed: an empty form keeps the product's word. */
function overrides(words: Words): TerminologyOverrides {
  const result: Record<string, unknown> = {};
  for (const key of KEYS) {
    const entry = words[key];
    if (!entry) continue;
    const noun = TERMINOLOGY_KEYS[key] === 'noun';
    const filled = LOCALES.every((code) => {
      const value = entry[code];
      return noun
        ? typeof value === 'object' && value.one.trim() && value.other.trim()
        : typeof value === 'string' && value.trim();
    });
    if (filled) result[key] = entry;
  }
  return result as TerminologyOverrides;
}

/**
 * Terminology (M2, spec 5.2): the tenant's own words for the terms that vary by industry, in every
 * language. A term left empty keeps the product's word. Labels follow with the next config read,
 * on the web at once and on phones at their next sync, with no release.
 */
export function TerminologyPage() {
  const { t } = useLanguage();
  const access = useAccess();
  const editable = access.can('terminology.manage');
  const current = useTerminology(editable);
  const admin = useAdmin();
  const [draft, setDraft] = useState<Words>();
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!editable) return <p className="ks-muted">{t('admin.no_access')}</p>;
  if (current.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(current.error, t)}
      </p>
    );
  }
  if (!current.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const words: Words = draft ?? (current.data.overrides as Words);
  const errors = fieldErrors(error);

  function change(key: TerminologyKey, code: Locale, form: 'one' | 'other' | null, text: string) {
    setSaved(false);
    const entry = { ...words[key] };
    if (form) {
      const before = (entry[code] as Noun | undefined) ?? { one: '', other: '' };
      entry[code] = { ...before, [form]: text };
    } else {
      entry[code] = text;
    }
    setDraft({ ...words, [key]: entry });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await admin.saveTerminology(overrides(words));
      setDraft(undefined);
      setSaved(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={save} aria-label={t('admin.terminology')}>
      <PageHeader title={t('admin.terminology')} intro={t('admin.terminology_intro')} />
      {KEYS.map((key) => {
        const noun = TERMINOLOGY_KEYS[key] === 'noun';
        return (
          <Section key={key} title={t(`admin.term_${key.slice(5) as TermName}`)}>
            <div className="grid gap-4 md:grid-cols-2">
              {LOCALES.flatMap((code) => {
                const value = words[key]?.[code];
                const product = productWord(key, code);
                const language = t(`admin.language_${code}`);
                return noun
                  ? (['one', 'other'] as const).map((form) => (
                      <TextField
                        key={`${code}-${form}`}
                        label={t(`admin.term_${form}`, { language })}
                        maxLength={60}
                        placeholder={(product as Noun)[form]}
                        value={(value as Noun | undefined)?.[form] ?? ''}
                        {...(errors[`${key}.${code}.${form}`]
                          ? { error: errors[`${key}.${code}.${form}`] }
                          : {})}
                        onChange={(event) => change(key, code, form, event.target.value)}
                      />
                    ))
                  : [
                      <TextField
                        key={code}
                        label={t('admin.term_label', { language })}
                        maxLength={40}
                        placeholder={product as string}
                        value={(value as string | undefined) ?? ''}
                        {...(errors[`${key}.${code}`] ? { error: errors[`${key}.${code}`] } : {})}
                        onChange={(event) => change(key, code, null, event.target.value)}
                      />,
                    ];
              })}
            </div>
          </Section>
        );
      })}
      <p className="ks-muted text-sm">{t('admin.terminology_empty')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
          {t('common.save')}
        </Button>
        {saved ? (
          <span className="ks-help" role="status">
            {t('admin.saved')}
          </span>
        ) : null}
        {error !== undefined && Object.keys(errors).length === 0 ? (
          <span className="ks-help error" role="alert">
            {errorMessage(error, t)}
          </span>
        ) : null}
      </div>
    </form>
  );
}
