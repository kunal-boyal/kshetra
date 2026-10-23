import type { AccountTypeView } from '@thelamp/forms';
import { type Column, DataTable, EmptyState, Icon, StatusBadge } from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { Plus, Store } from 'lucide-react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader } from '../people/shared';
import { useTypeList } from './types-data';

/** Account types (M2, spec 5.5): each with its version, fields and whether it is in use. */
export function TypesPage() {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const types = useTypeList();
  const editable = access.can('settings.manage');
  const columns: Column<AccountTypeView>[] = [
    {
      key: 'name',
      header: t('people.name'),
      render: (type) =>
        editable ? (
          <Link
            to="/settings/account-types/$typeId"
            params={{ typeId: type.id }}
            className="font-semibold text-[var(--accent)]"
          >
            {type.name[locale].other}
          </Link>
        ) : (
          type.name[locale].other
        ),
    },
    { key: 'key', header: t('roles.key'), render: (type) => <code>{type.key}</code> },
    {
      key: 'version',
      header: t('types.version'),
      align: 'end',
      render: (type) => String(type.version),
    },
    {
      key: 'fields',
      header: t('types.fields'),
      align: 'end',
      render: (type) => String(type.fields.length),
    },
    {
      key: 'status',
      header: t('types.status'),
      render: (type) =>
        type.active ? (
          <StatusBadge variant="success">{t('types.in_use')}</StatusBadge>
        ) : (
          <StatusBadge variant="neutral">{t('types.switched_off')}</StatusBadge>
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('types.title')} intro={t('types.intro')}>
        {editable ? (
          <Link to="/settings/account-types/new" className="ks-btn primary">
            <Icon icon={Plus} />
            {t('types.add')}
          </Link>
        ) : null}
      </PageHeader>
      {types.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(types.error, t)}
        </p>
      ) : types.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('types.title')}
          columns={columns}
          rows={types.data}
          rowKey={(type) => type.id}
          empty={
            <EmptyState icon={<Icon icon={Store} />} title={t('types.empty')}>
              {t('types.intro')}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
