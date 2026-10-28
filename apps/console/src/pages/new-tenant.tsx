import { emailMessage, mobileMessage } from '@thelamp/i18n';
import { Link, useNavigate } from '@tanstack/react-router';
import { newId } from '@thelamp/shared';
import {
  Button,
  Card,
  ChoiceCard,
  cn,
  DescriptionList,
  type Hue,
  IconChip,
  Notice,
  SelectField,
  TextField,
} from '@thelamp/ui-web';
import { ArrowLeft, Check } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useConsoleMutations, usePlans, useTemplates } from '../data';
import { EmailField, MobileField } from '../fields';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';

/** A slug from a name: lowercase letters, digits and hyphens, starting with a letter. */
export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 40);
}

const STEPS = ['company', 'template', 'admin', 'plan', 'review'] as const;

/** The step a refused field is on, by the first part of its path. */
const STEP_OF: Record<string, number> = {
  name: 0,
  slug: 0,
  template: 1,
  admin: 2,
  planId: 3,
  status: 3,
  trialDays: 3,
};

const HUES = ['sage', 'sky', 'butter', 'lilac', 'sand'] as const satisfies readonly Hue[];

/**
 * A new tenant from an industry template, with its first admin (module M22, decision D88). The
 * form names the tenant's ID once, so sending it twice makes one tenant.
 */
export function NewTenantPage() {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const templates = useTemplates();
  const plans = usePlans();
  const { createTenant } = useConsoleMutations();
  const [id] = useState(newId);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [template, setTemplate] = useState('');
  const [planId, setPlanId] = useState('');
  const [status, setStatus] = useState<'trial' | 'active'>('trial');
  const [trialDays, setTrialDays] = useState('30');
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();

  const chosenSlug = slugTouched ? slug : slugOf(name);
  const chosenTemplate = template || templates.data?.items[0]?.key || '';

  async function create(event: FormEvent) {
    event.preventDefault();
    // A number or address that can't be one is explained here, before anything is sent (D102).
    if (mobileMessage(adminPhone) || emailMessage(adminEmail)) {
      setChecked(true);
      setStep(STEPS.indexOf('admin'));
      return;
    }
    setErrors({});
    setFailure(undefined);
    try {
      const made = await createTenant.mutateAsync({
        id,
        name: name.trim(),
        slug: chosenSlug,
        template: chosenTemplate,
        planId: planId || null,
        status,
        ...(status === 'trial' ? { trialDays: Number(trialDays) } : {}),
        admin: {
          name: adminName.trim(),
          phone: adminPhone.trim(),
          ...(adminEmail.trim() ? { email: adminEmail.trim() } : {}),
        },
      });
      await navigate({ to: '/tenants/$tenantId', params: { tenantId: made.id } });
    } catch (error) {
      const found = fieldErrors(error);
      setErrors(found);
      setFailure(errorMessage(error, t));
      // Back to the first step a refused field is on.
      const steps = Object.keys(found).map((path) => STEP_OF[path.split('.')[0]!] ?? last);
      if (steps.length > 0) setStep(Math.min(...steps));
    }
  }

  const chosen = templates.data?.items.find((item) => item.key === chosenTemplate);
  const plan = plans.data?.items.find((item) => item.id === planId);
  // Each step's fields must be filled before the next; the server judges them on create.
  const ready = [
    Boolean(name.trim() && chosenSlug),
    Boolean(chosenTemplate),
    Boolean(adminName.trim() && adminPhone.trim()),
    status === 'active' || Boolean(trialDays),
    true,
  ];
  const last = STEPS.length - 1;

  return (
    <>
      <Link to="/" className="ks-btn ghost sm self-start">
        <ArrowLeft size={16} aria-hidden="true" />
        {t('console.tenants')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="heading-xl">{t('console.new_tenant')}</h1>
        <p className="ks-meta">{t('console.step_of', { step: step + 1, steps: STEPS.length })}</p>
      </div>
      <ol className="flex flex-wrap gap-2" aria-label={t('console.steps')}>
        {STEPS.map((key, index) => {
          const state = index < step ? 'done' : index === step ? 'now' : 'todo';
          return (
            <li
              key={key}
              className={cn(
                'flex flex-[1_1_8.75rem] items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2.5',
                state === 'now'
                  ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                  : 'border-[var(--border)] bg-[var(--surface)]',
              )}
              {...(state === 'now' ? { 'aria-current': 'step' as const } : {})}
            >
              <span
                className={cn(
                  'ks-seq',
                  state === 'done' && 'bg-[var(--success-solid)]! text-[var(--on-accent)]!',
                  state === 'now' && 'bg-[var(--accent)]! text-[var(--on-accent)]!',
                )}
              >
                {state === 'done' ? <Check size={14} aria-hidden="true" /> : index + 1}
              </span>
              <span className="font-semibold">{t(`console.step_${key}`)}</span>
            </li>
          );
        })}
      </ol>
      <form
        className="flex flex-wrap items-start gap-4"
        onSubmit={(event) => {
          if (step < last) {
            event.preventDefault();
            if (ready[step]) setStep(step + 1);
            return;
          }
          void create(event);
        }}
        noValidate
        aria-label={t('console.new_tenant')}
      >
        <section
          className="flex min-w-0 flex-[3_1_32rem] flex-col gap-4"
          aria-label={t(`console.step_${STEPS[step]!}`)}
        >
          <h2 className="heading-lg">{t(`console.step_${STEPS[step]!}_title`)}</h2>
          {STEPS[step] === 'company' ? (
            <Card className="flex max-w-xl flex-col gap-4">
              <TextField
                label={t('console.tenant_name')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                error={errors.name}
                required
              />
              <TextField
                label={t('console.col_slug')}
                help={t('console.slug_help')}
                value={chosenSlug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
                error={errors.slug}
                required
              />
            </Card>
          ) : STEPS[step] === 'template' ? (
            <>
              <div
                className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3"
                role="group"
                aria-label={t('console.col_template')}
              >
                {(templates.data?.items ?? []).map((item, index) => (
                  <ChoiceCard
                    key={item.key}
                    title={item.name[locale]}
                    description={item.description[locale]}
                    hue={HUES[index % HUES.length]!}
                    icon={
                      <IconChip size="sm" hue={HUES[index % HUES.length]!}>
                        {item.name[locale].slice(0, 2).toUpperCase()}
                      </IconChip>
                    }
                    pressed={item.key === chosenTemplate}
                    onClick={() => setTemplate(item.key)}
                  >
                    <span className="caption ks-subtle">{item.terms[locale]}</span>
                  </ChoiceCard>
                ))}
              </div>
              {errors.template ? <p className="ks-help error">{errors.template}</p> : null}
              <Notice>{t('console.template_note')}</Notice>
            </>
          ) : STEPS[step] === 'admin' ? (
            <Card className="flex max-w-xl flex-col gap-4">
              <TextField
                label={t('console.admin_name')}
                value={adminName}
                onChange={(event) => setAdminName(event.target.value)}
                error={errors['admin.name']}
                required
              />
              <MobileField
                label={t('console.admin_phone')}
                autoComplete="off"
                checked={checked}
                value={adminPhone}
                onChange={setAdminPhone}
                error={errors['admin.phone']}
                required
              />
              <EmailField
                label={t('console.admin_email')}
                autoComplete="off"
                checked={checked}
                value={adminEmail}
                onChange={setAdminEmail}
                error={errors['admin.email']}
              />
            </Card>
          ) : STEPS[step] === 'plan' ? (
            <Card className="flex max-w-xl flex-col gap-4">
              <SelectField
                label={t('console.col_plan')}
                none={t('console.no_plan_option')}
                value={planId}
                onChange={(event) => setPlanId(event.target.value)}
                options={(plans.data?.items ?? [])
                  .filter((entry) => entry.active)
                  .map((entry) => ({ value: entry.id, label: entry.name[locale] }))}
                error={errors.planId}
              />
              <SelectField
                label={t('console.opens_as')}
                value={status}
                onChange={(event) => setStatus(event.target.value as 'trial' | 'active')}
                options={(['trial', 'active'] as const).map((value) => ({
                  value,
                  label: t(`console.status_${value}`),
                }))}
              />
              {status === 'trial' ? (
                <TextField
                  label={t('console.trial_days')}
                  numeric
                  inputMode="numeric"
                  value={trialDays}
                  onChange={(event) => setTrialDays(event.target.value.replace(/\D/g, ''))}
                  error={errors.trialDays}
                />
              ) : null}
            </Card>
          ) : (
            <Notice>{t('console.review_note')}</Notice>
          )}
          {failure ? (
            <p className="ks-help error" role="alert">
              {failure}
            </p>
          ) : null}
        </section>
        <aside
          className="ks-card flex min-w-0 flex-[1_1_17.5rem] flex-col gap-3"
          aria-label={t('console.so_far')}
        >
          <h2 className="heading-md">{t('console.so_far')}</h2>
          <DescriptionList
            items={[
              [t('console.tenant_name'), name.trim() || '—'],
              [t('console.col_slug'), chosenSlug ? <code>{chosenSlug}</code> : '—'],
              [
                t('console.col_template'),
                chosen
                  ? t('console.template_version', {
                      name: chosen.name[locale],
                      version: chosen.version,
                    })
                  : '—',
              ],
              [t('console.first_admin'), adminName.trim() || '—'],
              [t('console.col_plan'), plan ? plan.name[locale] : t('console.no_plan')],
              [
                t('console.opens_as'),
                status === 'trial'
                  ? t('console.trial_for', { days: trialDays || '0' })
                  : t('console.status_active'),
              ],
            ]}
          />
          <div className="flex flex-wrap gap-2">
            {step > 0 ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setStep(step - 1)}>
                {t('console.back')}
              </Button>
            ) : null}
            {step < last ? (
              <Button type="submit" variant="primary" size="sm" disabled={!ready[step]}>
                {t('console.continue')}
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                busy={createTenant.isPending}
                disabled={ready.some((done) => !done)}
              >
                {t('console.create_tenant')}
              </Button>
            )}
          </div>
        </aside>
      </form>
    </>
  );
}
