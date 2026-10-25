import { Link } from '@tanstack/react-router';
import { formatMoney, formatNumber } from '@thelamp/i18n';
import type { PlanResult } from '@thelamp/shared';
import { Button, type Column, DataTable, EmptyState } from '@thelamp/ui-web';
import { Plus, Tags } from 'lucide-react';
import { useConsole } from '../context';
import { usePlans } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { holds, moduleName, PlanStatusBadge } from './shared';

/** Every plan, with its prices, modules, cap and tenants (module M23, decision D89). */
export function PlansPage() {
  const { client } = useConsole();
  const { t, locale } = useLanguage();
  const plans = usePlans();
  const manages = holds(client.staff, 'platform.plan.manage');

  const columns: Column<PlanResult>[] = [
    {
      key: 'name',
      header: t('console.col_plan'),
      render: (row) =>
        manages ? (
          <Link to="/plans/$planId" params={{ planId: row.id }} className="font-semibold">
            {row.name[locale]}
          </Link>
        ) : (
          <span className="font-semibold">{row.name[locale]}</span>
        ),
    },
    { key: 'key', header: t('console.col_key'), render: (row) => row.key },
    {
      key: 'month',
      header: t('console.col_price_month'),
      align: 'end',
      render: (row) => formatMoney(row.priceMonth as `${number}`, { locale }),
    },
    {
      key: 'year',
      header: t('console.col_price_year'),
      align: 'end',
      render: (row) => formatMoney(row.priceYear as `${number}`, { locale }),
    },
    {
      key: 'modules',
      header: t('console.col_modules'),
      render: (row) => row.modules.map((key) => moduleName(key, t)).join(', '),
    },
    {
      key: 'limit',
      header: t('console.col_people_limit'),
      align: 'end',
      render: (row) =>
        row.limits.users === null
          ? t('console.no_limit')
          : formatNumber(row.limits.users, { locale }),
    },
    {
      key: 'tenants',
      header: t('console.col_tenants'),
      align: 'end',
      render: (row) => formatNumber(row.tenants, { locale }),
    },
    {
      key: 'status',
      header: t('console.col_status'),
      render: (row) => <PlanStatusBadge active={row.active} />,
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="heading-xl">{t('console.plans')}</h1>
        {manages ? (
          <Link to="/plans/new" className="ks-btn primary">
            <Plus size={16} aria-hidden="true" />
            {t('console.new_plan')}
          </Link>
        ) : null}
      </div>
      {plans.isError ? (
        <>
          <p className="ks-help error" role="alert">
            {errorMessage(plans.error, t)}
          </p>
          <Button variant="secondary" className="self-start" onClick={() => void plans.refetch()}>
            {t('common.retry')}
          </Button>
        </>
      ) : plans.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('console.plans')}
          columns={columns}
          rows={plans.data.items}
          rowKey={(row) => row.id}
          empty={
            <EmptyState icon={<Tags aria-hidden="true" />} title={t('console.no_plans_title')}>
              {t('console.no_plans')}
            </EmptyState>
          }
        />
      )}
    </>
  );
}
