import { Link, useNavigate } from '@tanstack/react-router';
import { newId } from '@thelamp/shared';
import { Button, Card, SelectField, TextField } from '@thelamp/ui-web';
import { ArrowLeft } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useConsoleMutations, useTemplates } from '../data';
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

/**
 * A new tenant from an industry template, with its first admin (module M22, decision D88). The
 * form names the tenant's ID once, so sending it twice makes one tenant.
 */
export function NewTenantPage() {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const templates = useTemplates();
  const { createTenant } = useConsoleMutations();
  const [id] = useState(newId);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [template, setTemplate] = useState('');
  const [status, setStatus] = useState<'trial' | 'active'>('trial');
  const [trialDays, setTrialDays] = useState('30');
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();

  const chosenSlug = slugTouched ? slug : slugOf(name);
  const chosenTemplate = template || templates.data?.items[0]?.key || '';

  async function create(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFailure(undefined);
    try {
      const made = await createTenant.mutateAsync({
        id,
        name: name.trim(),
        slug: chosenSlug,
        template: chosenTemplate,
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
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error, t));
    }
  }

  return (
    <>
      <Link to="/" className="ks-btn ghost sm self-start">
        <ArrowLeft size={16} aria-hidden="true" />
        {t('console.tenants')}
      </Link>
      <h1 className="heading-xl">{t('console.new_tenant')}</h1>
      <Card>
        <form className="flex max-w-xl flex-col gap-4" onSubmit={create} noValidate>
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
          <SelectField
            label={t('console.col_template')}
            value={chosenTemplate}
            onChange={(event) => setTemplate(event.target.value)}
            options={(templates.data?.items ?? []).map((item) => ({
              value: item.key,
              label: item.name[locale],
            }))}
            help={
              templates.data?.items.find((item) => item.key === chosenTemplate)?.description[locale]
            }
            error={errors.template}
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
          <h2 className="heading-md">{t('console.first_admin')}</h2>
          <TextField
            label={t('console.admin_name')}
            value={adminName}
            onChange={(event) => setAdminName(event.target.value)}
            error={errors['admin.name']}
            required
          />
          <TextField
            label={t('console.admin_phone')}
            type="tel"
            autoComplete="off"
            value={adminPhone}
            onChange={(event) => setAdminPhone(event.target.value)}
            error={errors['admin.phone']}
            required
          />
          <TextField
            label={t('console.admin_email')}
            type="email"
            autoComplete="off"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            error={errors['admin.email']}
          />
          {failure ? (
            <p className="ks-help error" role="alert">
              {failure}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            busy={createTenant.isPending}
            disabled={
              !name.trim() ||
              !chosenSlug ||
              !chosenTemplate ||
              !adminName.trim() ||
              !adminPhone.trim()
            }
          >
            {t('console.create_tenant')}
          </Button>
        </form>
      </Card>
    </>
  );
}
