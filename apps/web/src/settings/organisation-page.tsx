import { Link } from '@tanstack/react-router';
import { formatNumber, TERMINOLOGY_DEFAULTS } from '@thelamp/i18n';
import {
  AVAILABLE_MODULES,
  collidesWithStatus,
  contrastRatio,
  deriveAccent,
  HEX_COLOUR,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  MODULE_KEYS,
  nearestPassingShade,
  type SwitchableModule,
  TERMINOLOGY_KEYS,
  type TerminologyKey,
  type UpdateSettingsBody,
} from '@thelamp/shared';
import { colors } from '@thelamp/design-tokens';
import {
  Button,
  DescriptionList,
  Icon,
  Notice,
  SelectField,
  StatusBadge,
  SwitchRow,
  TextAreaField,
  TextField,
} from '@thelamp/ui-web';
import { ImageUp, RotateCcw, Save, Trash2 } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { useAdmin, useOrganisation } from './data';
import { timeZones } from './rules-page';

/** What a change came to: saved, refused by the API, or stopped here with our own words. */
type Said =
  { ok: true } | { ok: false; error: unknown } | { ok: false; message: string } | undefined;

function Outcome({ said }: { said: Said }) {
  const { t } = useLanguage();
  if (!said) return null;
  return said.ok ? (
    <p className="ks-help" role="status">
      {t('admin.saved')}
    </p>
  ) : (
    <p className="ks-help error" role="alert">
      {'message' in said ? said.message : errorMessage(said.error, t)}
    </p>
  );
}

/** What the page edits and saves at once. */
interface Draft {
  name: string;
  legalName: string;
  address: string;
  taxId: string;
  privacyPolicyUrl: string;
  /** Empty for the product's own colour. */
  brandColour: string;
  timezone: string;
  modulesOff: SwitchableModule[];
}

const TERMS = Object.keys(TERMINOLOGY_KEYS) as TerminologyKey[];

/**
 * The organisation (M2, spec 5.1), as the prototype's settings page draws it (decision D104): the
 * brand and its words on the left, the modules and the field rules on the right, one Save under
 * both. The logo goes up when chosen; everything else waits for Save, which sends only what
 * changed.
 */
export function OrganisationPage() {
  const { client, queryClient } = useApp();
  const { t } = useLanguage();
  const access = useAccess();
  const config = useConfig(client, queryClient);
  const organisation = useOrganisation();
  const admin = useAdmin();
  const [draft, setDraft] = useState<Draft>();
  const [said, setSaid] = useState<Said>();
  const [busy, setBusy] = useState(false);
  const bundle = config.data?.bundle;
  if (!bundle || !organisation.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const settings = bundle.settings;
  const saved: Draft = {
    name: organisation.data.name,
    legalName: settings.legalName ?? '',
    address: settings.address ?? '',
    taxId: settings.taxId ?? '',
    privacyPolicyUrl: settings.privacyPolicyUrl ?? '',
    brandColour: settings.brandColour ?? '',
    timezone: settings.timezone,
    modulesOff: settings.modulesOff,
  };
  const value = draft ?? saved;
  const set = (change: Partial<Draft>) => {
    setSaid(undefined);
    setDraft({ ...value, ...change });
  };
  const errors = said && 'error' in said ? fieldErrors(said.error) : {};
  const colourOk =
    value.brandColour === '' ||
    (HEX_COLOUR.test(value.brandColour) && contrastRatio(value.brandColour, '#ffffff') >= 4.5);

  /** The settings that differ from what is saved, as the API takes them. */
  function changes(): UpdateSettingsBody {
    const text = (entry: string) => entry.trim() || null;
    const body: Record<string, unknown> = {};
    for (const key of ['legalName', 'address', 'taxId', 'privacyPolicyUrl'] as const) {
      if (value[key] !== saved[key]) body[key] = text(value[key]);
    }
    if (value.brandColour !== saved.brandColour) body.brandColour = value.brandColour || null;
    if (value.timezone !== saved.timezone) body.timezone = value.timezone;
    if (value.modulesOff.join() !== saved.modulesOff.join()) body.modulesOff = value.modulesOff;
    return body as UpdateSettingsBody;
  }
  const renamed = value.name.trim() !== saved.name;
  const changed = renamed || Object.keys(changes()).length > 0;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaid(undefined);
    try {
      if (renamed) await admin.rename(value.name);
      const body = changes();
      if (Object.keys(body).length > 0) await admin.saveSettings(body);
      setDraft(undefined);
      setSaid({ ok: true });
    } catch (error) {
      setSaid({ ok: false, error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={save} aria-label={t('admin.organisation')}>
      <PageHeader title={t('admin.organisation')} intro={t('admin.organisation_intro')} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[3_1_32rem] flex-col gap-4">
          <Section title={t('organisation.brand')}>
            <Logo />
            <BrandColour
              value={value.brandColour}
              onChange={(brandColour) => set({ brandColour })}
            />
            <TextField
              label={t('admin.display_name')}
              help={t('admin.display_name_help')}
              required
              value={value.name}
              maxLength={120}
              {...(errors.name ? { error: errors.name } : {})}
              onChange={(event) => set({ name: event.target.value })}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label={t('admin.legal_name')}
                value={value.legalName}
                maxLength={200}
                {...(errors.legalName ? { error: errors.legalName } : {})}
                onChange={(event) => set({ legalName: event.target.value })}
              />
              <TextField
                label={t('admin.tax_id')}
                help={t('admin.tax_id_help')}
                value={value.taxId}
                maxLength={15}
                {...(errors.taxId ? { error: errors.taxId } : {})}
                onChange={(event) => set({ taxId: event.target.value.toUpperCase() })}
              />
            </div>
            <TextAreaField
              label={t('admin.address')}
              value={value.address}
              maxLength={500}
              rows={3}
              {...(errors.address ? { error: errors.address } : {})}
              onChange={(event) => set({ address: event.target.value })}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                label={t('admin.rule_timezone')}
                value={value.timezone}
                options={timeZones(value.timezone).map((zone) => ({ value: zone, label: zone }))}
                {...(errors.timezone ? { error: errors.timezone } : {})}
                onChange={(event) => set({ timezone: event.target.value })}
              />
              <TextField
                label={t('admin.privacy_url')}
                help={t('admin.privacy_url_help')}
                type="url"
                value={value.privacyPolicyUrl}
                maxLength={500}
                {...(errors.privacyPolicyUrl ? { error: errors.privacyPolicyUrl } : {})}
                onChange={(event) => set({ privacyPolicyUrl: event.target.value })}
              />
            </div>
          </Section>
          <Words terms={bundle.terminology} />
        </div>
        <div className="flex min-w-0 flex-[2_1_20rem] flex-col gap-4">
          <Section title={t('admin.modules')}>
            <div className="flex flex-col">
              {MODULE_KEYS.map((key) =>
                key === 'core' || !AVAILABLE_MODULES.includes(key) ? (
                  <div key={key} className="ks-switch-row">
                    <span className="ks-switch-text">
                      <span className="ks-title">{t(`admin.module_${key}`)}</span>
                      <span className="ks-meta">{t(`admin.module_${key}_about`)}</span>
                    </span>
                    <StatusBadge variant={key === 'core' ? 'info' : 'neutral'}>
                      {t(key === 'core' ? 'admin.module_always_on' : 'admin.module_coming')}
                    </StatusBadge>
                  </div>
                ) : (
                  <SwitchRow
                    key={key}
                    label={t(`admin.module_${key}`)}
                    description={t(`admin.module_${key}_about`)}
                    checked={!value.modulesOff.includes(key)}
                    disabled={!access.can('module.manage')}
                    onChange={(on) =>
                      set({
                        modulesOff: on
                          ? value.modulesOff.filter((entry) => entry !== key)
                          : [...value.modulesOff, key],
                      })
                    }
                  />
                ),
              )}
            </div>
          </Section>
          <FieldRules />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Outcome said={said} />
        <Link to="/settings/configuration" className="ks-btn secondary sm">
          {t('organisation.export')}
        </Link>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          busy={busy}
          disabled={!changed || !colourOk}
          icon={<Icon icon={Save} />}
        >
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

/** The logo: PNG, JPEG or WebP, resized by the server; it goes up as soon as it is chosen. */
function Logo() {
  const { t } = useLanguage();
  const organisation = useOrganisation();
  const admin = useAdmin();
  const inputId = useId();
  const [said, setSaid] = useState<Said>();
  const [busy, setBusy] = useState(false);
  const logo = organisation.data?.logo;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setSaid(undefined);
    try {
      await work();
      setSaid({ ok: true });
    } catch (error) {
      setSaid({ ok: false, error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="ks-label">{t('admin.logo')}</span>
      <div className="flex flex-wrap items-center gap-4">
        {logo ? (
          <img
            src={logo.url}
            alt={t('admin.logo_current')}
            className="h-16 w-auto max-w-[12rem] rounded-[var(--radius-sm)] border border-[var(--border)] object-contain p-2"
          />
        ) : (
          <p className="ks-muted">{t('admin.logo_none')}</p>
        )}
        <label htmlFor={inputId} className="ks-btn secondary sm cursor-pointer">
          <Icon icon={ImageUp} />
          {logo ? t('admin.logo_replace') : t('admin.logo_add')}
        </label>
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept={LOGO_TYPES.join(',')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            if (file.size > LOGO_MAX_BYTES) {
              setSaid({ ok: false, message: t('admin.logo_too_big') });
              return;
            }
            void run(() => admin.setLogo(file));
          }}
        />
        {logo ? (
          <Button
            variant="ghost"
            size="sm"
            busy={busy}
            icon={<Icon icon={Trash2} />}
            onClick={() => void run(() => admin.removeLogo())}
          >
            {t('admin.logo_remove')}
          </Button>
        ) : null}
      </div>
      <p className="ks-help">{t('admin.logo_help')}</p>
      <Outcome said={said} />
    </div>
  );
}

/** The brand colour, with what it makes of buttons and chips (tenant-theming.md). */
function BrandColour({ value, onChange }: { value: string; onChange: (colour: string) => void }) {
  const { t } = useLanguage();
  const valid = HEX_COLOUR.test(value);
  const passes = valid && contrastRatio(value, '#ffffff') >= 4.5;
  const shade = valid && !passes ? nearestPassingShade(value) : null;
  const preview = passes ? deriveAccent(value).palettes.light : null;
  return (
    <div className="flex flex-col gap-2">
      <span className="ks-label">{t('admin.brand_colour')}</span>
      <div className="flex flex-wrap items-end gap-3">
        <span
          aria-hidden="true"
          className="size-11 rounded-[var(--radius-sm)] shadow-[inset_0_0_0_1px_var(--border)]"
          // The tenant's own colour, as the swatch shows it; the product's until one is chosen.
          style={{ background: valid ? value : colors.light.accent }}
        />
        <TextField
          label={t('admin.brand_hex')}
          className="max-w-[10rem]"
          value={value}
          placeholder={colors.light.accent}
          {...(valid && !passes ? { error: t('admin.brand_too_light') } : {})}
          onChange={(event) => onChange(event.target.value.trim())}
        />
        <input
          type="color"
          aria-label={t('admin.brand_pick')}
          className="h-10 w-14 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border)]"
          value={valid ? value : colors.light.accent}
          onChange={(event) => onChange(event.target.value)}
        />
        {shade ? (
          <Button variant="secondary" size="sm" onClick={() => onChange(shade)}>
            {t('admin.brand_use_shade', { colour: shade })}
          </Button>
        ) : null}
        {value ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon icon={RotateCcw} />}
            onClick={() => onChange('')}
          >
            {t('admin.brand_reset')}
          </Button>
        ) : null}
      </div>
      <p className="ks-help">{t('admin.brand_help')}</p>
      {preview ? (
        <div
          className="flex flex-wrap items-center gap-3"
          role="group"
          aria-label={t('admin.brand_preview')}
        >
          <span
            className="rounded-[var(--radius-full)] px-4 py-2 font-semibold"
            style={{ background: preview.accent, color: preview['on-accent'] }}
          >
            {t('admin.brand_sample_button')}
          </span>
          <span
            className="rounded-[var(--radius-full)] px-3 py-1 text-sm"
            style={{ background: preview['accent-subtle'], color: preview['accent-subtle-fg'] }}
          >
            {t('admin.brand_sample_chip')}
          </span>
        </div>
      ) : null}
      {passes && collidesWithStatus(value) ? <Notice>{t('admin.brand_collides')}</Notice> : null}
    </div>
  );
}

/** One form of a term: a label's text, or a noun's one form. */
function word(entry: unknown): string {
  return typeof entry === 'string' ? entry : ((entry as { one: string } | undefined)?.one ?? '');
}

/** The organisation's words beside the product's, in each language, as the config bundle has them. */
function Words({
  terms,
}: {
  terms: Partial<Record<'en' | 'hi', Partial<Record<TerminologyKey, unknown>>>>;
}) {
  const { t } = useLanguage();
  const access = useAccess();
  return (
    <Section
      title={t('organisation.words')}
      actions={
        access.can('terminology.manage') ? (
          <Link to="/settings/terminology" className="ks-btn ghost sm">
            {t('organisation.change_words')}
          </Link>
        ) : (
          <span className="ks-meta">{t('organisation.words_meta')}</span>
        )
      }
    >
      <div
        className="overflow-x-auto"
        role="region"
        aria-label={t('organisation.words')}
        tabIndex={0}
      >
        <table className="ks-table shadow-none!">
          <thead>
            <tr>
              <th scope="col">{t('organisation.col_product')}</th>
              <th scope="col">{t('admin.language_en')}</th>
              <th scope="col">{t('admin.language_hi')}</th>
            </tr>
          </thead>
          <tbody>
            {TERMS.map((key) => (
              <tr key={key}>
                <td>{word(TERMINOLOGY_DEFAULTS.en[key])}</td>
                <td>{word(terms.en?.[key] ?? TERMINOLOGY_DEFAULTS.en[key])}</td>
                <td lang="hi">{word(terms.hi?.[key] ?? TERMINOLOGY_DEFAULTS.hi[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** The field rules people ask about most, with a way to the Rules page. */
function FieldRules() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const config = useConfig(client, queryClient);
  const settings = config.data?.bundle.settings;
  if (!settings) return null;
  const count = (value: number) => formatNumber(value, { locale });
  return (
    <Section
      title={t('organisation.field_rules')}
      actions={
        access.can('settings.manage') ? (
          <Link to="/settings/rules" className="ks-btn ghost sm">
            {t('organisation.change_rules')}
          </Link>
        ) : null
      }
    >
      <DescriptionList
        items={[
          [
            t('organisation.rule_geofence'),
            t('organisation.geofence_value', { metres: count(settings.geofenceRadiusMeters) }),
          ],
          [
            t('organisation.rule_auto'),
            t(settings.reviewAutoApproval ? 'organisation.auto_on' : 'organisation.auto_off'),
          ],
          [
            t('organisation.rule_tracking'),
            t('organisation.tracking_value', { seconds: count(settings.gpsIntervalSeconds) }),
          ],
          [
            t('organisation.rule_phones'),
            t(settings.deviceBinding ? 'organisation.phones_one' : 'organisation.phones_any'),
          ],
          [
            t('organisation.rule_photos'),
            t('organisation.months_value', {
              months: count(settings.evidencePhotoRetentionMonths),
            }),
          ],
        ]}
      />
    </Section>
  );
}
