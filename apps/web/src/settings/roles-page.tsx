import {
  DATA_SCOPES,
  type DataScope,
  type PermissionArea,
  PERMISSIONS_BY_AREA,
  RoleResult,
  type TenantPermission,
} from '@thelamp/shared';
import {
  Button,
  Checkbox,
  ChoiceGroup,
  type Column,
  DataTable,
  Icon,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Save } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, useRoles, write } from '../people/data';
import { fieldErrors, PageHeader } from '../people/shared';

interface Draft {
  id?: string;
  key: string;
  en: string;
  hi: string;
  scope: DataScope;
  mobileOnly: boolean;
  permissions: TenantPermission[];
}

const AREAS = Object.keys(PERMISSIONS_BY_AREA) as PermissionArea[];

/**
 * Roles (spec 4.2, M2): what people may do and whose records they reach. Nobody gives access they
 * don't hold, so the server refuses a role beyond the editor's own (`canGrant`).
 */
export function RolesPage() {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const roles = useRoles();
  const [draft, setDraft] = useState<Draft>();
  const editable = access.can('role.manage');

  const columns: Column<RoleResult>[] = [
    { key: 'name', header: t('people.name'), render: (role) => role.name[locale] },
    { key: 'key', header: t('roles.key'), render: (role) => <code>{role.key}</code> },
    { key: 'scope', header: t('roles.scope'), render: (role) => t(`scope.${role.scope}`) },
    {
      key: 'permissions',
      header: t('roles.permissions'),
      align: 'end',
      render: (role) => t('roles.permission_count', { count: role.permissions.length }),
    },
    {
      key: 'flags',
      header: '',
      render: (role) => (
        <span className="flex flex-wrap gap-1">
          {role.mobileOnly ? (
            <StatusBadge variant="info">{t('roles.mobile_only')}</StatusBadge>
          ) : null}
          {role.system ? <StatusBadge variant="neutral">{t('roles.built_in')}</StatusBadge> : null}
        </span>
      ),
    },
    {
      key: 'edit',
      header: '',
      render: (role) =>
        editable ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setDraft({
                id: role.id,
                key: role.key,
                en: role.name.en,
                hi: role.name.hi,
                scope: role.scope,
                mobileOnly: role.mobileOnly,
                permissions: [...role.permissions],
              })
            }
          >
            {t('common.edit')}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('roles.title')} intro={t('roles.intro')}>
        {editable && !draft ? (
          <Button
            variant="primary"
            icon={<Icon icon={Plus} />}
            onClick={() =>
              setDraft({
                key: '',
                en: '',
                hi: '',
                scope: 'self',
                mobileOnly: false,
                permissions: [],
              })
            }
          >
            {t('roles.add')}
          </Button>
        ) : null}
      </PageHeader>
      {draft ? <RoleEditor draft={draft} onDone={() => setDraft(undefined)} /> : null}
      {roles.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(roles.error, t)}
        </p>
      ) : (
        <DataTable
          caption={t('roles.title')}
          columns={columns}
          rows={roles.data ?? []}
          rowKey={(role) => role.id}
        />
      )}
    </div>
  );
}

function RoleEditor({ draft: initial, onDone }: { draft: Draft; onDone: () => void }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const toggle = (permission: TenantPermission, on: boolean) =>
    setDraft((current) => ({
      ...current,
      permissions: on
        ? [...current.permissions, permission]
        : current.permissions.filter((held) => held !== permission),
    }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setBusy(true);
    const name = { en: draft.en.trim(), hi: draft.hi.trim() };
    try {
      if (draft.id) {
        await write(client, 'PATCH', `/v1/roles/${draft.id}`, RoleResult, {
          name,
          scope: draft.scope,
          mobileOnly: draft.mobileOnly,
          permissions: draft.permissions,
        });
      } else {
        await write(client, 'POST', '/v1/roles', RoleResult, {
          key: draft.key.trim(),
          name,
          scope: draft.scope,
          mobileOnly: draft.mobileOnly,
          permissions: draft.permissions,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['roles'] }),
        queryClient.invalidateQueries({ queryKey: ['config'] }),
      ]);
      onDone();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="ks-card flex flex-col gap-4"
      aria-label={draft.id ? draft.en : t('roles.new_title')}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <h2 className="heading-md">{draft.id ? draft.en : t('roles.new_title')}</h2>
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        {draft.id ? null : (
          <TextField
            label={t('roles.key')}
            help={t('roles.key_help')}
            required
            value={draft.key}
            {...(errors.key ? { error: errors.key } : {})}
            onChange={(event) => setDraft({ ...draft, key: event.target.value })}
          />
        )}
        <TextField
          label={t('roles.name_en')}
          required
          value={draft.en}
          {...(errors['name.en'] ? { error: errors['name.en'] } : {})}
          onChange={(event) => setDraft({ ...draft, en: event.target.value })}
        />
        <TextField
          label={t('roles.name_hi')}
          required
          value={draft.hi}
          {...(errors['name.hi'] ? { error: errors['name.hi'] } : {})}
          onChange={(event) => setDraft({ ...draft, hi: event.target.value })}
        />
        <SelectField
          label={t('roles.scope')}
          value={draft.scope}
          options={DATA_SCOPES.map((scope) => ({ value: scope, label: t(`scope.${scope}`) }))}
          {...(errors.scope ? { error: errors.scope } : {})}
          onChange={(event) => setDraft({ ...draft, scope: event.target.value as DataScope })}
        />
      </div>
      <Checkbox
        label={t('roles.mobile_only')}
        detail={t('roles.mobile_only_help')}
        checked={draft.mobileOnly}
        onChange={(event) => setDraft({ ...draft, mobileOnly: event.target.checked })}
      />
      <ChoiceGroup
        legend={t('roles.permissions')}
        {...(errors.permissions ? { error: errors.permissions } : {})}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {AREAS.map((area) => (
            <fieldset key={area} className="flex flex-col">
              <legend className="label-sm ks-muted">{t(`area.${area}`)}</legend>
              {PERMISSIONS_BY_AREA[area].map((permission) => (
                <Checkbox
                  key={permission}
                  label={t(`perm.${permission}`)}
                  detail={permission}
                  checked={draft.permissions.includes(permission)}
                  onChange={(event) => toggle(permission, event.target.checked)}
                />
              ))}
            </fieldset>
          ))}
        </div>
      </ChoiceGroup>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
          {t('common.save')}
        </Button>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}
