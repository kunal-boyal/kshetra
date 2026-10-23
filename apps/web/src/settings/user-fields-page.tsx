import { type CustomField, UserFieldsResult } from '@thelamp/forms';
import { Button, Icon, Notice } from '@thelamp/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { Save, Undo2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, useUserFields, write } from '../people/data';
import { fieldErrors, PageHeader } from '../people/shared';
import { CustomFieldsEditor, draftOf, fieldOf } from './custom-fields-editor';

/**
 * The tenant's custom people fields (spec 5.3): what the organisation keeps about each person
 * beyond the standard details. A field left out retires, its key kept with its type.
 */
export function UserFieldsPage() {
  const { t } = useLanguage();
  const fields = useUserFields();
  if (fields.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  if (fields.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(fields.error, t)}
      </p>
    );
  }
  return <Editor fields={fields.data.fields} retired={fields.data.retired} />;
}

function Editor({
  fields,
  retired,
}: {
  fields: readonly CustomField[];
  retired: readonly CustomField[];
}) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState(() => fields.map(draftOf));
  const [failure, setFailure] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const editable = access.can('settings.manage');
  const known = new Set([...fields, ...retired].map((field) => field.key));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setSaved(false);
    setBusy(true);
    try {
      await write(client, 'PUT', '/v1/user-fields', UserFieldsResult, {
        fields: drafts.map(fieldOf),
      });
      await queryClient.invalidateQueries({ queryKey: ['user-fields'] });
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const back = retired.filter((field) => !drafts.some((draft) => draft.key === field.key));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('fields.title')} intro={t('fields.intro')} />
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        {saved ? <Notice>{t('common.saved')}</Notice> : null}
        {failure ? (
          <div className="ks-help error" role="alert">
            <p>{errorMessage(failure, t)}</p>
            <ul>
              {Object.entries(errors).map(([path, issue]) => (
                <li key={path}>
                  <code>{path}</code>: {issue}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <CustomFieldsEditor
          drafts={drafts}
          onChange={setDrafts}
          known={known}
          errors={errors}
          path="fields"
          editable={editable}
        />
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
              {t('fields.save')}
            </Button>
          </div>
        ) : null}
      </form>

      {back.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label={t('fields.retired')}>
          <h2 className="heading-md">{t('fields.retired')}</h2>
          <p className="ks-muted">{t('fields.retired_help')}</p>
          <ul className="flex flex-col gap-2">
            {back.map((field) => (
              <li key={field.key} className="flex flex-wrap items-center gap-3">
                <span>{field.label[locale]}</span>
                <code>{field.key}</code>
                <span className="ks-muted">{t(`field_type.${field.type}`)}</span>
                {editable ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Icon icon={Undo2} size="sm" />}
                    onClick={() => setDrafts([...drafts, draftOf(field)])}
                  >
                    {t('fields.add')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
