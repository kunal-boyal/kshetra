import { DesignationResult } from '@kshetra/shared';
import {
  Button,
  Checkbox,
  type Column,
  DataTable,
  Icon,
  SelectField,
  StatusBadge,
  TextField,
} from '@kshetra/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Save } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, useDesignations, useRoles, write } from '../people/data';
import { fieldErrors, PageHeader } from '../people/shared';

interface Draft {
  id?: string;
  key: string;
  oneEn: string;
  otherEn: string;
  oneHi: string;
  otherHi: string;
  level: string;
  defaultRole: string;
  canHaveReports: boolean;
  ranked: boolean;
}

/**
 * Designations (spec 4.2, 5.3, M2): job titles with a level, 1 the highest. A designation grants
 * nothing itself; its default role is what new people with it get.
 */
export function DesignationsPage() {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const designations = useDesignations();
  const roles = useRoles();
  const [draft, setDraft] = useState<Draft>();
  const editable = access.can('designation.manage');
  const roleName = (key: string) =>
    roles.data?.find((role) => role.key === key)?.name[locale] ?? key;

  const columns: Column<DesignationResult>[] = [
    { key: 'name', header: t('people.name'), render: (entry) => entry.name[locale].one },
    { key: 'key', header: t('roles.key'), render: (entry) => <code>{entry.key}</code> },
    {
      key: 'level',
      header: t('designations.level'),
      align: 'end',
      render: (entry) => entry.level,
    },
    {
      key: 'role',
      header: t('designations.default_role'),
      render: (entry) => roleName(entry.defaultRole),
    },
    {
      key: 'flags',
      header: '',
      render: (entry) => (
        <span className="flex flex-wrap gap-1">
          {entry.canHaveReports ? (
            <StatusBadge variant="info">{t('designations.can_have_reports')}</StatusBadge>
          ) : null}
          {entry.ranked ? (
            <StatusBadge variant="neutral">{t('designations.ranked')}</StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'edit',
      header: '',
      render: (entry) =>
        editable ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setDraft({
                id: entry.id,
                key: entry.key,
                oneEn: entry.name.en.one,
                otherEn: entry.name.en.other,
                oneHi: entry.name.hi.one,
                otherHi: entry.name.hi.other,
                level: String(entry.level),
                defaultRole: entry.defaultRole,
                canHaveReports: entry.canHaveReports,
                ranked: entry.ranked,
              })
            }
          >
            {t('common.edit')}
          </Button>
        ) : null,
    },
  ];

  const sorted = [...(designations.data ?? [])].sort((a, b) => a.level - b.level);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('designations.title')} intro={t('designations.intro')}>
        {editable && !draft ? (
          <Button
            variant="primary"
            icon={<Icon icon={Plus} />}
            onClick={() =>
              setDraft({
                key: '',
                oneEn: '',
                otherEn: '',
                oneHi: '',
                otherHi: '',
                level: '3',
                defaultRole: roles.data?.[0]?.key ?? '',
                canHaveReports: false,
                ranked: false,
              })
            }
          >
            {t('designations.add')}
          </Button>
        ) : null}
      </PageHeader>
      {draft ? (
        <DesignationEditor
          draft={draft}
          roles={(roles.data ?? []).map((role) => ({ value: role.key, label: role.name[locale] }))}
          onDone={() => setDraft(undefined)}
        />
      ) : null}
      {designations.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(designations.error, t)}
        </p>
      ) : (
        <DataTable
          caption={t('designations.title')}
          columns={columns}
          rows={sorted}
          rowKey={(entry) => entry.id}
        />
      )}
    </div>
  );
}

function DesignationEditor({
  draft: initial,
  roles,
  onDone,
}: {
  draft: Draft;
  roles: { value: string; label: string }[];
  onDone: () => void;
}) {
  const { client } = useApp();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const field = (key: keyof Draft, value: string | boolean) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setBusy(true);
    const changes = {
      name: {
        en: { one: draft.oneEn.trim(), other: draft.otherEn.trim() },
        hi: { one: draft.oneHi.trim(), other: draft.otherHi.trim() },
      },
      level: Number(draft.level),
      defaultRole: draft.defaultRole,
      canHaveReports: draft.canHaveReports,
      ranked: draft.ranked,
    };
    try {
      if (draft.id) {
        await write(client, 'PATCH', `/v1/designations/${draft.id}`, DesignationResult, changes);
      } else {
        await write(client, 'POST', '/v1/designations', DesignationResult, {
          key: draft.key.trim(),
          ...changes,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['designations'] }),
        queryClient.invalidateQueries({ queryKey: ['config'] }),
      ]);
      onDone();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const title = draft.id ? draft.oneEn : t('designations.new_title');
  return (
    <form
      className="ks-card flex flex-col gap-4"
      aria-label={title}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <h2 className="heading-md">{title}</h2>
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {draft.id ? null : (
          <TextField
            label={t('roles.key')}
            help={t('roles.key_help')}
            required
            value={draft.key}
            {...(errors.key ? { error: errors.key } : {})}
            onChange={(event) => field('key', event.target.value)}
          />
        )}
        <TextField
          label={t('designations.level')}
          help={t('designations.level_help')}
          type="number"
          min={1}
          max={10}
          required
          value={draft.level}
          {...(errors.level ? { error: errors.level } : {})}
          onChange={(event) => field('level', event.target.value)}
        />
        <TextField
          label={t('designations.one_en')}
          required
          value={draft.oneEn}
          {...(errors['name.en.one'] ? { error: errors['name.en.one'] } : {})}
          onChange={(event) => field('oneEn', event.target.value)}
        />
        <TextField
          label={t('designations.other_en')}
          required
          value={draft.otherEn}
          {...(errors['name.en.other'] ? { error: errors['name.en.other'] } : {})}
          onChange={(event) => field('otherEn', event.target.value)}
        />
        <TextField
          label={t('designations.one_hi')}
          required
          value={draft.oneHi}
          {...(errors['name.hi.one'] ? { error: errors['name.hi.one'] } : {})}
          onChange={(event) => field('oneHi', event.target.value)}
        />
        <TextField
          label={t('designations.other_hi')}
          required
          value={draft.otherHi}
          {...(errors['name.hi.other'] ? { error: errors['name.hi.other'] } : {})}
          onChange={(event) => field('otherHi', event.target.value)}
        />
        <SelectField
          label={t('designations.default_role')}
          required
          value={draft.defaultRole}
          options={roles}
          {...(errors.defaultRole ? { error: errors.defaultRole } : {})}
          onChange={(event) => field('defaultRole', event.target.value)}
        />
      </div>
      <Checkbox
        label={t('designations.can_have_reports')}
        checked={draft.canHaveReports}
        onChange={(event) => field('canHaveReports', event.target.checked)}
      />
      <Checkbox
        label={t('designations.ranked')}
        checked={draft.ranked}
        onChange={(event) => field('ranked', event.target.checked)}
      />
      {errors.canHaveReports ? (
        <p className="ks-help error" role="alert">
          {errors.canHaveReports}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
          {t('common.save')}
        </Button>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}
