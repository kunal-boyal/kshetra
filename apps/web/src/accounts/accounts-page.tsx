import { formatMoney, formatNumber } from '@thelamp/i18n';
import type { AccountStatus, AccountResult } from '@thelamp/shared';
import {
  Checkbox,
  Button,
  type Column,
  DataTable,
  EmptyState,
  Icon,
  PageHeader,
  SelectField,
  StatusBadge,
  Tabs,
  tabPanelProps,
  TextField,
} from '@thelamp/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Search, Store, Upload } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { useSettled } from '../people/shared';
import { AccountsMap } from './accounts-map';
import { type AccountFilters, useAccounts, useAccountTypes } from './data';
import { AccountStatusBadge, slotName } from './shared';

/**
 * Accounts (spec 8.2, decision D104): a table per type, chosen by tabs with their counts, of the
 * accounts the viewer sees, found by name or code, with their location and outstanding balance;
 * the type's own fields and segments are on each account's page. A banner
 * says how many of the type wait for approval and shows them.
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
  const [onMap, setOnMap] = useState(false);
  const settled = useSettled(q.trim());
  const filters: AccountFilters = {
    type: type?.key ?? '',
    ...(settled ? { q: settled } : {}),
    ...(status ? { status } : {}),
    ...(segment ? { segment } : {}),
  };
  const accounts = useAccounts(filters, type !== undefined);
  const rows = accounts.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = accounts.data?.pages[0]?.summary ?? null;
  const n = (value: number) => formatNumber(value, { locale });

  const columns: Column<AccountResult>[] = [
    {
      key: 'code',
      header: t('account.code'),
      align: 'num',
      render: (account) => <code className="whitespace-nowrap">{account.code}</code>,
    },
    {
      key: 'name',
      header: t('account.name'),
      render: (account) => (
        <Link
          to="/accounts/$accountId"
          params={{ accountId: account.id }}
          className="font-semibold"
        >
          {account.name}
        </Link>
      ),
    },
    {
      key: 'territory',
      header: t('account.territory'),
      render: (account) => account.territory.name,
    },
    {
      key: 'parent',
      header: t('account.parent'),
      render: (account) => account.parent?.name ?? '—',
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
    {
      key: 'location',
      header: t('account.location'),
      render: (account) => (
        <StatusBadge variant={account.locationStatus === 'verified' ? 'success' : 'waiting'}>
          {t(`account.location_${account.locationStatus}`)}
        </StatusBadge>
      ),
    },
    {
      key: 'outstanding',
      header: t('account.outstanding'),
      align: 'end',
      render: (account) =>
        account.outstanding === null
          ? '—'
          : formatMoney(account.outstanding as `${number}`, { locale, currency: access.currency }),
    },
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
      <PageHeader
        title={t('accounts.title')}
        meta={t('accounts.meta')}
        actions={
          <>
            {access.can('import.run') ? (
              <Link to="/imports" className="ks-btn secondary sm">
                <Icon icon={Upload} size="sm" />
                {t('accounts.import')}
              </Link>
            ) : null}
            {type && access.can('account.manage') ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Icon icon={Plus} />}
                onClick={() => void navigate({ to: '/accounts/new', search: { type: type.key } })}
              >
                {t('accounts.add', { type: type.name[locale].one })}
              </Button>
            ) : null}
          </>
        }
        toolbar={
          types.length > 1 && type ? (
            <Tabs
              label={t('accounts.type')}
              idPrefix="account-types"
              value={type.key}
              formatCount={n}
              onChange={(next) => {
                setSegment('');
                setStatus('');
                void navigate({ to: '/accounts', search: { type: next } });
              }}
              choices={types.map((entry) => ({
                value: entry.key,
                label: entry.name[locale].other,
                ...(summary ? { count: summary.types[entry.key] ?? 0 } : {}),
              }))}
            />
          ) : null
        }
      />
      {summary && summary.pending > 0 && status !== 'pending' && type ? (
        <div className="ks-banner info m-0" role="status">
          <span>
            {t('accounts.pending_banner', {
              count: summary.pending,
              n: n(summary.pending),
              type: summary.pending === 1 ? type.name[locale].one : type.name[locale].other,
            })}
          </span>
          <button type="button" className="ks-banner-act" onClick={() => setStatus('pending')}>
            {t('accounts.pending_review')}
          </button>
        </div>
      ) : null}
      <div
        className="grid gap-4 md:grid-cols-[2fr_1fr_1fr]"
        role="search"
        {...(types.length > 1 && type ? tabPanelProps('account-types', type.key) : {})}
      >
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

      <Checkbox
        label={t('accounts.show_map')}
        checked={onMap}
        onChange={(event) => setOnMap(event.target.checked)}
      />
      {onMap && type ? <AccountsMap type={type.key} name={type.name[locale].other} /> : null}

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
