import { ApiError } from '@thelamp/api-client';
import { type FormDefinition, type FormField, FormView, VISIT_ORDERED } from '@thelamp/forms';
import {
  Button,
  Checkbox,
  ChoiceGroup,
  cn,
  Icon,
  Notice,
  SelectField,
  TextField,
} from '@thelamp/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Send, Smartphone } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useAccountTypes } from '../accounts/data';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { useDesignations, useRoles, write } from '../people/data';
import { PageHeader } from '../people/shared';
import { useForms, useRefreshForms } from './data';
import { type AnyFormField, keysOf, newForm, tidy } from './drafts';
import { ConditionEditor, FieldList } from './field-editor';
import { PhonePreview } from './preview';

export function NewFormPage() {
  return <FormBuilder />;
}

export function EditFormPage({ formId }: { formId: string }) {
  const { t } = useLanguage();
  const forms = useForms();
  if (forms.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(forms.error, t)}
      </p>
    );
  }
  if (forms.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  const form = forms.data.find((entry) => entry.id === formId);
  if (!form) {
    return (
      <p className="ks-help error" role="alert">
        {t('builder.not_found')}
      </p>
    );
  }
  return <FormBuilder form={form} />;
}

const toInt = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined);

/**
 * The form builder (spec 5.6, 8.2): a form's settings and its fields, in order, each with its
 * own settings and a condition on earlier fields. Publishing makes the next version; phones take
 * it at their next sync, and submissions already made keep the version they were filled in.
 */
/** The form element, which the header's Publish submits. */
const FORM_ID = 'form-builder';

function FormBuilder({ form }: { form?: FormView }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const refresh = useRefreshForms();
  const accountTypes = (useAccountTypes() ?? []).map((type) => ({
    key: type.key,
    name: type.name[locale].other,
  }));
  const roles = useRoles().data ?? [];
  const designations = useDesignations().data ?? [];
  const [draft, setDraft] = useState<FormDefinition>(() => {
    if (!form) return newForm();
    // The definition alone: what makes it a version is the server's to say.
    const definition: Partial<FormView> = { ...form };
    delete definition.id;
    delete definition.version;
    delete definition.active;
    return definition as FormDefinition;
  });
  const [failure, setFailure] = useState<unknown>();
  const [published, setPublished] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const problems = failure instanceof ApiError ? failure.details : [];
  const at = (path: string) =>
    problems.find((problem) => problem.path === `definition.${path}`)?.issue;
  const error = (path: string) => (at(path) ? { error: at(path)! } : {});
  const set = (patch: Partial<FormDefinition>) => setDraft((current) => ({ ...current, ...patch }));
  const name = (language: 'en' | 'hi', form: 'one' | 'other', value: string) =>
    set({ name: { ...draft.name, [language]: { ...draft.name[language], [form]: value } } });
  const [locked] = useState(() => (form ? keysOf(form.fields) : new Set<string>()));
  const link = draft.accountLink;
  const linked = link.mode === 'none' ? [] : link.accountTypes;
  // What conditions see before the first field: in a visit, whether it took an order (D97).
  const facts: AnyFormField[] = draft.visitSession
    ? [
        {
          key: VISIT_ORDERED,
          type: 'yes_no',
          label: { en: t('builder.visit_ordered'), hi: t('builder.visit_ordered') },
          required: false,
        },
      ]
    : [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setPublished(undefined);
    setBusy(true);
    try {
      const body = { definition: tidy(draft) };
      const saved = (
        form
          ? await write(client, 'POST', `/v1/forms/${form.id}/versions`, FormView, body)
          : await write(client, 'POST', '/v1/forms', FormView, body)
      )!;
      await refresh();
      if (form) {
        setPublished(saved.version);
      } else {
        await navigate({ to: '/settings/forms/$formId', params: { formId: saved.id } });
      }
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={form ? form.name[locale].one : t('builder.new_title')}
        back={{ to: '/settings/forms', label: t('forms.title') }}
        intro={form ? t('builder.edit_intro', { version: form.version }) : t('builder.new_intro')}
      >
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-pressed={previewing}
          icon={<Icon icon={Smartphone} />}
          onClick={() => setPreviewing((now) => !now)}
        >
          {t('builder.preview_phone')}
        </Button>
        <Button
          type="submit"
          form={FORM_ID}
          size="sm"
          variant="primary"
          busy={busy}
          icon={<Icon icon={Send} />}
        >
          {form
            ? t('builder.publish_version', { version: form.version + 1 })
            : t('builder.publish')}
        </Button>
      </PageHeader>
      <div
        className={cn('grid items-start gap-6', previewing && 'xl:grid-cols-[minmax(0,1fr)_360px]')}
      >
        <form
          id={FORM_ID}
          className="flex min-w-0 flex-col gap-6"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <section className="ks-card flex flex-col gap-4" aria-labelledby="form-basics">
            <h2 id="form-basics" className="heading-md">
              {t('builder.basics')}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label={t('builder.form_key')}
                help={t(form ? 'builder.form_key_kept' : 'builder.key_help')}
                required
                readOnly={form !== undefined}
                value={draft.key}
                {...error('key')}
                onChange={(event) => set({ key: event.target.value })}
              />
              <TextField
                label={t('builder.icon')}
                help={t('builder.icon_help')}
                value={draft.icon}
                {...error('icon')}
                onChange={(event) => set({ icon: event.target.value.trim() })}
              />
              <TextField
                label={t('builder.name_one_en')}
                required
                value={draft.name.en.one}
                {...error('name.en.one')}
                onChange={(event) => name('en', 'one', event.target.value)}
              />
              <TextField
                label={t('builder.name_other_en')}
                required
                value={draft.name.en.other}
                {...error('name.en.other')}
                onChange={(event) => name('en', 'other', event.target.value)}
              />
              <TextField
                label={t('builder.name_one_hi')}
                lang="hi"
                value={draft.name.hi.one}
                {...error('name.hi.one')}
                onChange={(event) => name('hi', 'one', event.target.value)}
              />
              <TextField
                label={t('builder.name_other_hi')}
                lang="hi"
                value={draft.name.hi.other}
                {...error('name.hi.other')}
                onChange={(event) => name('hi', 'other', event.target.value)}
              />
              <TextField
                label={t('builder.tags')}
                help={t('builder.tags_help')}
                value={draft.tags.join(', ')}
                {...error('tags')}
                onChange={(event) =>
                  set({
                    tags: event.target.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          </section>

          <section className="ks-card flex flex-col gap-4" aria-labelledby="form-where">
            <h2 id="form-where" className="heading-md">
              {t('builder.where')}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                label={t('builder.account_link')}
                value={link.mode}
                options={(['none', 'optional', 'required'] as const).map((mode) => ({
                  value: mode,
                  label: t(`builder.link_${mode}`),
                }))}
                {...error('accountLink')}
                onChange={(event) => {
                  const mode = event.target.value as 'none' | 'optional' | 'required';
                  set({
                    accountLink:
                      mode === 'none'
                        ? { mode }
                        : {
                            mode,
                            accountTypes:
                              linked.length > 0
                                ? linked
                                : accountTypes.slice(0, 1).map((type) => type.key),
                          },
                    ...(mode !== 'required' ? { visitSession: false } : {}),
                  });
                }}
              />
              {link.mode !== 'none' ? (
                <ChoiceGroup
                  legend={t('builder.link_types')}
                  {...(at('accountLink.accountTypes')
                    ? { error: at('accountLink.accountTypes')! }
                    : {})}
                >
                  {accountTypes.map((type) => (
                    <Checkbox
                      key={type.key}
                      label={type.name}
                      checked={linked.includes(type.key)}
                      onChange={(event) =>
                        set({
                          accountLink: {
                            mode: link.mode,
                            accountTypes: event.target.checked
                              ? [...linked, type.key]
                              : linked.filter((key) => key !== type.key),
                          },
                        })
                      }
                    />
                  ))}
                </ChoiceGroup>
              ) : null}
              <Checkbox
                label={t('builder.visit_session')}
                detail={at('visitSession') ?? t('builder.visit_session_help')}
                disabled={link.mode !== 'required'}
                checked={draft.visitSession}
                onChange={(event) => set({ visitSession: event.target.checked })}
              />
              <SelectField
                label={t('builder.shift')}
                value={draft.shift}
                options={(['required', 'allowed_off_shift'] as const).map((value) => ({
                  value,
                  label: t(`builder.shift_${value}`),
                }))}
                onChange={(event) => set({ shift: event.target.value as FormDefinition['shift'] })}
              />
              <SelectField
                label={t('builder.geofence')}
                value={draft.geofence}
                options={(['inherit', 'off', 'advisory', 'required'] as const).map((value) => ({
                  value,
                  label: t(`builder.geofence_${value}`),
                }))}
                onChange={(event) =>
                  set({ geofence: event.target.value as FormDefinition['geofence'] })
                }
              />
              <SelectField
                label={t('builder.review')}
                value={draft.review}
                options={(['manual', 'auto', 'none'] as const).map((value) => ({
                  value,
                  label: t(`builder.review_${value}`),
                }))}
                onChange={(event) =>
                  set({ review: event.target.value as FormDefinition['review'] })
                }
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <ChoiceGroup legend={t('builder.audience_roles')}>
                {roles.map((role) => (
                  <Checkbox
                    key={role.key}
                    label={role.name[locale]}
                    checked={draft.audience?.roles.includes(role.key) ?? false}
                    onChange={(event) => {
                      const chosen = draft.audience?.roles ?? [];
                      const next = event.target.checked
                        ? [...chosen, role.key]
                        : chosen.filter((key) => key !== role.key);
                      set({
                        audience: { roles: next, designations: draft.audience?.designations ?? [] },
                      });
                    }}
                  />
                ))}
              </ChoiceGroup>
              <ChoiceGroup legend={t('builder.audience_designations')}>
                {designations.map((designation) => (
                  <Checkbox
                    key={designation.key}
                    label={designation.name[locale].one}
                    checked={draft.audience?.designations.includes(designation.key) ?? false}
                    onChange={(event) => {
                      const chosen = draft.audience?.designations ?? [];
                      const next = event.target.checked
                        ? [...chosen, designation.key]
                        : chosen.filter((key) => key !== designation.key);
                      set({ audience: { roles: draft.audience?.roles ?? [], designations: next } });
                    }}
                  />
                ))}
              </ChoiceGroup>
            </div>
            <p className="ks-muted">{t('builder.audience_help')}</p>
          </section>

          <section className="ks-card flex flex-col gap-4" aria-labelledby="form-proof">
            <h2 id="form-proof" className="heading-md">
              {t('builder.proof')}
            </h2>
            <Checkbox
              label={t('builder.photos')}
              checked={draft.photos !== undefined}
              onChange={(event) =>
                set({
                  photos: event.target.checked ? { min: 1, max: 3, source: 'camera' } : undefined,
                })
              }
            />
            {draft.photos ? (
              <div className="grid gap-4 md:grid-cols-3">
                <TextField
                  label={t('builder.photos_min')}
                  help={t('builder.photos_min_help')}
                  inputMode="numeric"
                  numeric
                  value={String(draft.photos.min)}
                  {...error('photos')}
                  onChange={(event) =>
                    set({ photos: { ...draft.photos!, min: toInt(event.target.value) ?? 0 } })
                  }
                />
                <TextField
                  label={t('builder.photos_max')}
                  inputMode="numeric"
                  numeric
                  value={String(draft.photos.max)}
                  onChange={(event) =>
                    set({ photos: { ...draft.photos!, max: toInt(event.target.value) ?? 1 } })
                  }
                />
                <SelectField
                  label={t('builder.photo_source')}
                  value={draft.photos.source}
                  options={[
                    { value: 'camera', label: t('builder.source_camera') },
                    { value: 'camera_and_gallery', label: t('builder.source_gallery') },
                  ]}
                  onChange={(event) =>
                    set({
                      photos: {
                        ...draft.photos!,
                        source: event.target.value as 'camera' | 'camera_and_gallery',
                      },
                    })
                  }
                />
              </div>
            ) : null}
            <SelectField
              label={t('builder.signature')}
              value={draft.signature}
              options={(['none', 'optional', 'required'] as const).map((value) => ({
                value,
                label: t(`builder.signature_${value}`),
              }))}
              onChange={(event) => {
                const signature = event.target.value as FormDefinition['signature'];
                // Only an optional signature is required by a condition.
                setDraft(({ signatureRequiredWhen, ...current }) => ({
                  ...current,
                  signature,
                  ...(signature === 'optional' && signatureRequiredWhen
                    ? { signatureRequiredWhen }
                    : {}),
                }));
              }}
            />
            {draft.signature === 'optional' ? (
              <ConditionEditor
                condition={draft.signatureRequiredWhen}
                earlier={[...facts, ...draft.fields]}
                legend={t('builder.signature_when')}
                addLabel={t('builder.add_signature_condition')}
                onChange={(signatureRequiredWhen) =>
                  setDraft((current) => {
                    const next = { ...current };
                    if (signatureRequiredWhen) next.signatureRequiredWhen = signatureRequiredWhen;
                    else delete next.signatureRequiredWhen;
                    return next;
                  })
                }
              />
            ) : null}
            {at('signatureRequiredWhen') ? (
              <p className="ks-help error" role="alert">
                {at('signatureRequiredWhen')}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-4" aria-labelledby="form-fields">
            <h2 id="form-fields" className="heading-md">
              {t('builder.fields')}
            </h2>
            {at('fields') ? (
              <p className="ks-help error" role="alert">
                {at('fields')}
              </p>
            ) : null}
            <FieldList
              fields={draft.fields}
              onChange={(fields) => set({ fields: fields as FormField[] })}
              context={{ accountTypes, problems, taken: keysOf(draft.fields), locked }}
              path="definition.fields"
              outer={facts}
              panes
            />
          </section>

          {failure ? (
            <div className="ks-help error" role="alert">
              <p>{errorMessage(failure, t)}</p>
              {problems.length > 0 ? (
                <ul>
                  {problems.map((problem) => (
                    <li key={`${problem.path}:${problem.issue}`}>
                      <code>{problem.path.replace(/^definition\./, '')}</code>: {problem.issue}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {published ? <Notice>{t('builder.published', { version: published })}</Notice> : null}
        </form>
        {previewing ? (
          <aside className="xl:sticky xl:top-4" aria-label={t('builder.preview_phone')}>
            <PhonePreview form={draft} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
