import {
  collidesWithStatus,
  contrastRatio,
  deriveAccent,
  HEX_COLOUR,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  nearestPassingShade,
} from '@thelamp/shared';
import { colors } from '@thelamp/design-tokens';
import { Button, Icon, Notice, TextAreaField, TextField } from '@thelamp/ui-web';
import { ImageUp, Palette, RotateCcw, Save, Trash2 } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { useAdmin, useOrganisation } from './data';

/** What a save says: done, or why not, under its own section. */
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

/** The display name and the legal details printed on exports (spec 5.1). */
function Details() {
  const { client, queryClient } = useApp();
  const { t } = useLanguage();
  const config = useConfig(client, queryClient);
  const organisation = useOrganisation();
  const admin = useAdmin();
  const settings = config.data?.bundle.settings;
  const [draft, setDraft] = useState<{
    name: string;
    legalName: string;
    address: string;
    taxId: string;
    privacyPolicyUrl: string;
  }>();
  const [said, setSaid] = useState<Said>();
  const [busy, setBusy] = useState(false);
  if (!settings || !organisation.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const value = draft ?? {
    name: organisation.data.name,
    legalName: settings.legalName ?? '',
    address: settings.address ?? '',
    taxId: settings.taxId ?? '',
    privacyPolicyUrl: settings.privacyPolicyUrl ?? '',
  };
  const errors = said && 'error' in said ? fieldErrors(said.error) : {};
  const set = (change: Partial<typeof value>) => setDraft({ ...value, ...change });

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaid(undefined);
    try {
      if (value.name.trim() !== organisation.data!.name) await admin.rename(value.name);
      await admin.saveSettings({
        legalName: value.legalName.trim() || null,
        address: value.address.trim() || null,
        taxId: value.taxId.trim() || null,
        privacyPolicyUrl: value.privacyPolicyUrl.trim() || null,
      });
      setDraft(undefined);
      setSaid({ ok: true });
    } catch (error) {
      setSaid({ ok: false, error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('admin.details')}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={save} aria-label={t('admin.details')}>
        <TextField
          label={t('admin.display_name')}
          help={t('admin.display_name_help')}
          required
          value={value.name}
          maxLength={120}
          {...(errors.name ? { error: errors.name } : {})}
          onChange={(event) => set({ name: event.target.value })}
        />
        <TextField
          label={t('admin.legal_name')}
          value={value.legalName}
          maxLength={200}
          {...(errors.legalName ? { error: errors.legalName } : {})}
          onChange={(event) => set({ legalName: event.target.value })}
        />
        <TextAreaField
          label={t('admin.address')}
          value={value.address}
          maxLength={500}
          rows={3}
          {...(errors.address ? { error: errors.address } : {})}
          onChange={(event) => set({ address: event.target.value })}
        />
        <TextField
          label={t('admin.tax_id')}
          help={t('admin.tax_id_help')}
          value={value.taxId}
          maxLength={15}
          {...(errors.taxId ? { error: errors.taxId } : {})}
          onChange={(event) => set({ taxId: event.target.value.toUpperCase() })}
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
        <div className="md:col-span-2">
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
            {t('common.save')}
          </Button>
        </div>
      </form>
      <Outcome said={said} />
    </Section>
  );
}

/** The logo: PNG, JPEG or WebP, resized by the server; shown in the header. */
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
    <Section title={t('admin.logo')}>
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
        <label htmlFor={inputId} className="ks-btn secondary cursor-pointer">
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
            busy={busy}
            icon={<Icon icon={Trash2} />}
            onClick={() => void run(() => admin.removeLogo())}
          >
            {t('admin.logo_remove')}
          </Button>
        ) : null}
      </div>
      <p className="ks-muted text-sm">{t('admin.logo_help')}</p>
      <Outcome said={said} />
    </Section>
  );
}

/** The brand colour, with what it makes of buttons and chips in each theme (tenant-theming.md). */
function BrandColour() {
  const { client, queryClient } = useApp();
  const { t } = useLanguage();
  const config = useConfig(client, queryClient);
  const admin = useAdmin();
  const saved = config.data?.bundle.settings.brandColour ?? null;
  const [draft, setDraft] = useState<string>();
  const [said, setSaid] = useState<Said>();
  const [busy, setBusy] = useState(false);
  const value = draft ?? saved ?? '';
  const valid = HEX_COLOUR.test(value);
  const passes = valid && contrastRatio(value, '#ffffff') >= 4.5;
  const shade = valid && !passes ? nearestPassingShade(value) : null;
  const preview = passes ? deriveAccent(value).palettes.light : null;

  async function save(colour: string | null) {
    setBusy(true);
    setSaid(undefined);
    try {
      await admin.saveSettings({ brandColour: colour });
      setDraft(undefined);
      setSaid({ ok: true });
    } catch (error) {
      setSaid({ ok: false, error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('admin.brand_colour')}>
      <p className="ks-muted">{t('admin.brand_help')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label={t('admin.brand_hex')}
          className="max-w-[12rem]"
          value={value}
          placeholder={colors.light.accent}
          {...(valid && !passes ? { error: t('admin.brand_too_light') } : {})}
          onChange={(event) => setDraft(event.target.value.trim())}
        />
        <input
          type="color"
          aria-label={t('admin.brand_pick')}
          className="h-10 w-14 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border)]"
          // The product's own accent until the tenant picks one.
          value={valid ? value : colors.light.accent}
          onChange={(event) => setDraft(event.target.value)}
        />
        {shade ? (
          <Button variant="secondary" onClick={() => setDraft(shade)}>
            {t('admin.brand_use_shade', { colour: shade })}
          </Button>
        ) : null}
      </div>
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
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          busy={busy}
          disabled={!passes || value === saved}
          icon={<Icon icon={Palette} />}
          onClick={() => void save(value)}
        >
          {t('admin.brand_save')}
        </Button>
        {saved ? (
          <Button
            variant="ghost"
            busy={busy}
            icon={<Icon icon={RotateCcw} />}
            onClick={() => void save(null)}
          >
            {t('admin.brand_reset')}
          </Button>
        ) : null}
      </div>
      <Outcome said={said} />
    </Section>
  );
}

/** The organisation (M2, spec 5.1): its name, legal details, logo and brand colour. */
export function OrganisationPage() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('admin.organisation')} intro={t('admin.organisation_intro')} />
      <Details />
      <Logo />
      <BrandColour />
    </div>
  );
}
