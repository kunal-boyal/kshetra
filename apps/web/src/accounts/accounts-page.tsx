import type { AccountStatus, AccountResult } from '@kshetra/shared';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  Icon,
  SelectField,
  TextField,
} from '@kshetra/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Search, Store } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { customValue } from '../people/custom-fields';
import { useAccess } from '../people/data';
import { PageHeader, useSettled } from '../people/shared';
import { type AccountFilters, useAccounts, useAccountTypes } from './data';
import { AccountStatusBadge, segmentName, slotName } from './shared';

/** Custom fields that show as columns, at most this many: the type's first ones. */
const CUSTOM_COLUMNS = 3;

/**
 * Accounts (spec 8.2): a table per type, with the type's own fields as columns, of the accounts
 * the viewer sees, found by name or code.
 */
export function AccountsPage({ type: chosen }: { type?: string }) {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const types = (useAccountTypes() ?? []).filter((type) => type.active);
  const type = types.find((entry) => entry.key === chosen) ?? types[0];
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<AccountStatus | ''>('');
  const [segment, setSegment] = useState('');
  const settled = useSettled(q.trim());
  const filters: AccountFilters = {
    type: type?.key ?? '',
    ...(settled ? { q: settled } : {}),
    ...(status ? { status } : {}),
    ...(segment ? { segment } : {}),
  };
  const accounts = useAccounts(filters, type !== undefined);
  const rows = accounts.data?.pages.flatMap((page) => page.items) ?? [];
  const custom = (type?.fields ?? [])
    .filter((field) => !['section', 'info_text', 'photo'].includes(field.type))
    .slice(0, CUSTOM_COLUMNS);

  const columns: Column<AccountResult>[] = [
    {
      key: 'name',
      header: t('account.name'),
      render: (account) => (
        <Link
          to="/accounts/$accountId"
          params={{ accountId: account.id }}
          className="flex flex-col"
        >
          <span className="font-semibold text-[var(--accent)]">{account.name}</span>
          <code>{account.code}</code>
        </Link>
      ),
    },
    {
      key: 'territory',
      header: t('account.territory'),
      render: (account) => account.territory.name,
    },
    {
      key: 'assignee',
      header: t('account.primary'),
      render: (account) => (
        <span className="flex flex-col">
          {account.slots.find((holder) => holder.slot === account.primarySlot)?.user.name ?? (
            <span className="ks-muted">{t('account.unassigned')}</span>
          )}
          {account.missingSlots.length > 0 ? (
            <span className="ks-help error">
              {t('account.needs', {
                slots: account.missingSlots.map((key) => slotName(type, key, locale)).join(', '),
              })}
            </span>
          ) : null}
        </span>
      ),
    },
    ...custom.map((field): Column<AccountResult> => ({
      key: `custom.${field.key}`,
      header: field.label[locale],
      render: (account) => customValue(field, account.custom[field.key], t, locale),
    })),
    ...((type?.segmentRules.length ?? 0) > 0
      ? [
          {
            key: 'segments',
            header: t('account.segments'),
            render: (account: AccountResult) =>
              account.segments.map((key) => segmentName(type, key, locale)).join(', ') || '—',
          } satisfies Column<AccountResult>,
        ]
      : []),
    {
      key: 'status',
      header: t('account.status'),
      render: (account) => <AccountStatusBadge status={account.status} />,
    },
  ];

  if (types.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('accounts.title')} />
        <EmptyState icon={<Icon icon={Store} />} title={t('accounts.no_types_title')}>
          {t('accounts.no_types_body')}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={type ? type.name[locale].other : t('accounts.title')}>
        {type && access.can('account.manage') ? (
          <Button
            variant="primary"
            icon={<Icon icon={Plus} />}
            onClick={() => void navigate({ to: '/accounts/new', search: { type: type.key } })}
          >
            {t('accounts.add', { type: type.name[locale].one })}
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-[1fr_2fr_1fr_1fr]" role="search">
        <SelectField
          label={t('accounts.type')}
          value={type?.key ?? ''}
          options={types.map((entry) => ({ value: entry.key, label: entry.name[locale].other }))}
          onChange={(event) => {
            setSegment('');
            void navigate({ to: '/accounts', search: { type: event.target.value } });
          }}
        />
        <TextField
          label={t('accounts.search')}
          help={t('accounts.search_help')}
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <SelectField
          label={t('account.status')}
          value={status}
          none={t('common.any')}
          options={(['active', 'pending', 'inactive'] as const).map((value) => ({
            value,
            label: t(`account.status_${value}`),
          }))}
          onChange={(event) => setStatus(event.target.value as AccountStatus | '')}
        />
        {(type?.segmentRules.length ?? 0) > 0 ? (
          <SelectField
            label={t('account.segment')}
            value={segment}
            none={t('common.any')}
            options={type!.segmentRules.map((rule) => ({
              value: rule.segment,
              label: rule.name[locale],
            }))}
            onChange={(event) => setSegment(event.target.value)}
          />
        ) : null}
      </div>

      {accounts.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(accounts.error, t)}
        </p>
      ) : accounts.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('accounts.caption', { type: type!.name[locale].other })}
          columns={columns}
          rows={rows}
          rowKey={(account) => account.id}
          empty={
            <EmptyState icon={<Icon icon={q ? Search : Store} />} title={t('accounts.empty_title')}>
              {t('accounts.empty_body')}
            </EmptyState>
          }
          {...(accounts.hasNextPage
            ? {
                more: {
                  label: t('common.load_more'),
                  busy: accounts.isFetchingNextPage,
                  onClick: () => void accounts.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
    </div>
  );
}
