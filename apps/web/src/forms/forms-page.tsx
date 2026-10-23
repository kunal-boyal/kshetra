import { type FormView, FormView as FormViewSchema } from '@thelamp/forms';
import { Button, type Column, DataTable, EmptyState, Icon, StatusBadge } from '@thelamp/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { ClipboardList, Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { write } from '../people/data';
import { PageHeader } from '../people/shared';
import { useForms, useRefreshForms } from './data';

/**
 * Forms (spec 5.6, 8.2): every form, in use or not, at its current version. A form switched off
 * leaves the phones at their next sync; its versions and submissions stay.
 */
export function FormsPage() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const forms = useForms();
  const refresh = useRefreshForms();
  const [busy, setBusy] = useState<string>();
  const [failure, setFailure] = useState<unknown>();

  async function toggle(form: FormView) {
    setBusy(form.id);
    setFailure(undefined);
    try {
      await write(client, 'PATCH', `/v1/forms/${form.id}`, FormViewSchema, {
        active: !form.active,
      });
      await refresh();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(undefined);
    }
  }

  const columns: Column<FormView>[] = [
    {
      key: 'name',
      header: t('forms.name'),
      render: (form) => (
        <Link to="/settings/forms/$formId" params={{ formId: form.id }} className="flex flex-col">
          <span className="font-semibold text-[var(--accent)]">{form.name[locale].one}</span>
          <code>{form.key}</code>
        </Link>
      ),
    },
    {
      key: 'fields',
      header: t('forms.fields'),
      align: 'end',
      render: (form) => form.fields.length,
    },
    {
      key: 'version',
      header: t('forms.version'),
      align: 'end',
      render: (form) => form.version,
    },
    {
      key: 'status',
      header: t('forms.status'),
      render: (form) => (
        <StatusBadge variant={form.active ? 'success' : 'neutral'}>
          {t(form.active ? 'forms.in_use' : 'forms.off')}
        </StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: t('forms.actions'),
      render: (form) => (
        <Button
          size="sm"
          variant="ghost"
          busy={busy === form.id}
          aria-label={t(form.active ? 'forms.switch_off_named' : 'forms.switch_on_named', {
            name: form.name[locale].one,
          })}
          onClick={() => void toggle(form)}
        >
          {t(form.active ? 'forms.switch_off' : 'forms.switch_on')}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('forms.title')} intro={t('forms.intro')}>
        <Button
          variant="primary"
          icon={<Icon icon={Plus} />}
          onClick={() => void navigate({ to: '/settings/forms/new' })}
        >
          {t('forms.add')}
        </Button>
      </PageHeader>
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {forms.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(forms.error, t)}
        </p>
      ) : forms.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('forms.caption')}
          columns={columns}
          rows={forms.data}
          rowKey={(form) => form.id}
          empty={
            <EmptyState icon={<Icon icon={ClipboardList} />} title={t('forms.empty_title')}>
              {t('forms.empty_body')}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
