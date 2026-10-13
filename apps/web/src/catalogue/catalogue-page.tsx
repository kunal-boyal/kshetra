import { formatMoney, formatNumber } from '@kshetra/i18n';
import { CatalogueResult, type ItemResult } from '@kshetra/shared';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  Icon,
  StatusBadge,
  TextField,
} from '@kshetra/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { FileSpreadsheet, Package, Search } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';
import { PageHeader } from '../people/shared';

/** The catalogue as the phones hold it: units, measures and every item. */
function useCatalogue() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['catalogue'],
    queryFn: () => read(client, '/v1/catalogue', CatalogueResult),
  });
}

/**
 * The catalogue (spec 5.11, 8.2): the items the tenant sells, by product, with their units and
 * tax. Items arrive through the item import (Appendix B.3); prices come in phase 2 (D38).
 */
export function CataloguePage() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const config = useConfig(client, queryClient);
  const catalogue = useCatalogue();
  const [q, setQ] = useState('');
  const currency = config.data?.bundle.settings.currency ?? 'INR';
  const unitName = (key: string, count: number) => {
    const unit = catalogue.data?.units.find((entry) => entry.key === key);
    if (!unit) return key;
    return unit.name[locale][count === 1 ? 'one' : 'other'];
  };
  const needle = q.trim().toLowerCase();
  const rows = (catalogue.data?.items ?? []).filter(
    (item) =>
      !needle ||
      [item.code, item.name, item.product.name, item.category?.name ?? ''].some((text) =>
        text.toLowerCase().includes(needle),
      ),
  );

  const columns: Column<ItemResult>[] = [
    {
      key: 'name',
      header: t('catalogue.item'),
      render: (item) => (
        <span className="flex flex-col">
          <span className="font-semibold">{item.name}</span>
          <code>{item.code}</code>
        </span>
      ),
    },
    {
      key: 'product',
      header: t('catalogue.product'),
      render: (item) => (
        <span className="flex flex-col">
          <span>{item.product.name}</span>
          {item.category ? <span className="ks-muted">{item.category.name}</span> : null}
        </span>
      ),
    },
    {
      key: 'pack',
      header: t('catalogue.pack'),
      render: (item) => item.packLabel ?? '—',
    },
    {
      key: 'units',
      header: t('catalogue.units'),
      render: (item) => (
        <span className="flex flex-col">
          {item.units.map((unit) =>
            unit.key === item.baseUnit ? (
              <span key={unit.key}>{unitName(unit.key, 1)}</span>
            ) : (
              <span key={unit.key}>
                {t('catalogue.unit_holds', {
                  unit: unitName(unit.key, 1),
                  count: formatNumber(unit.factor as `${number}`, { locale }),
                  base: unitName(item.baseUnit, Number(unit.factor)),
                })}
              </span>
            ),
          )}
        </span>
      ),
    },
    {
      key: 'tax',
      header: t('catalogue.tax_rate'),
      align: 'end',
      render: (item) =>
        `${formatNumber(item.taxRate as `${number}`, { locale }, { maximumFractionDigits: 4 })}%`,
    },
    {
      key: 'mrp',
      header: t('catalogue.mrp'),
      align: 'end',
      render: (item) =>
        item.mrp ? formatMoney(item.mrp as `${number}`, { locale, currency }) : '—',
    },
    {
      key: 'status',
      header: t('catalogue.status'),
      render: (item) => (
        <StatusBadge variant={item.active ? 'success' : 'neutral'}>
          {t(item.active ? 'catalogue.active' : 'catalogue.inactive')}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('catalogue.title')} intro={t('catalogue.intro')}>
        {access.can('import.run') ? (
          <Button
            variant="primary"
            icon={<Icon icon={FileSpreadsheet} />}
            onClick={() => void navigate({ to: '/imports' })}
          >
            {t('catalogue.import')}
          </Button>
        ) : null}
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-2" role="search">
        <TextField
          label={t('catalogue.search')}
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>
      {catalogue.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(catalogue.error, t)}
        </p>
      ) : catalogue.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('catalogue.caption')}
          columns={columns}
          rows={rows}
          rowKey={(item) => item.id}
          empty={
            <EmptyState
              icon={<Icon icon={needle ? Search : Package} />}
              title={t(needle ? 'catalogue.no_match' : 'catalogue.empty_title')}
            >
              {t(needle ? 'catalogue.no_match_body' : 'catalogue.empty_body')}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
