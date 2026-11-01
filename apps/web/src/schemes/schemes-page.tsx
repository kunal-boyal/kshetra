import { formatDate } from '@thelamp/i18n';
import type { SchemeResult } from '@thelamp/shared';
import { Button, type Column, DataTable, EmptyState, Icon, StatusBadge } from '@thelamp/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { BadgePercent, Plus } from 'lucide-react';
import { errorMessage, useLanguage } from '../i18n';
import { PageHeader } from '../people/shared';
import { useSchemes } from './data';
import { useGives } from './shared';

/**
 * Schemes and promotions (M10, BR-55, decision D127): what each gives, whom it reaches and when.
 * Orders take the one best for the customer on each line, on the phone, at the order desk and on
 * the server alike.
 */
export function SchemesPage() {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const schemes = useSchemes();
  const gives = useGives();

  const columns: Column<SchemeResult>[] = [
    {
      key: 'name',
      header: t('schemes.scheme'),
      render: (scheme) => (
        <span className="flex flex-col">
          <Link
            to="/settings/schemes/$schemeId"
            params={{ schemeId: scheme.id }}
            className="font-semibold"
          >
            {scheme.name[locale]}
          </Link>
          <code className="ks-muted text-sm">{scheme.key}</code>
        </span>
      ),
    },
    { key: 'gives', header: t('schemes.gives'), render: (scheme) => gives(scheme) },
    {
      key: 'reaches',
      header: t('schemes.reaches'),
      render: (scheme) => {
        const parts = [
          scheme.itemIds.length > 0
            ? t('schemes.count_items', { count: scheme.itemIds.length })
            : null,
          scheme.categoryIds.length > 0
            ? t('schemes.count_categories', { count: scheme.categoryIds.length })
            : null,
          scheme.accountTypeKeys.length > 0
            ? t('schemes.count_types', { count: scheme.accountTypeKeys.length })
            : null,
          scheme.territoryIds.length > 0
            ? t('schemes.count_territories', { count: scheme.territoryIds.length })
            : null,
        ].filter((part): part is string => part !== null);
        return parts.length > 0 ? parts.join(' · ') : t('schemes.everything');
      },
    },
    {
      key: 'dates',
      header: t('prices.dates'),
      render: (scheme) =>
        scheme.validTo
          ? t('prices.between', {
              from: formatDate(scheme.validFrom, { locale }),
              to: formatDate(scheme.validTo, { locale }),
            })
          : t('prices.from', { from: formatDate(scheme.validFrom, { locale }) }),
    },
    {
      key: 'status',
      header: t('catalogue.status'),
      render: (scheme) => (
        <StatusBadge variant={scheme.active ? 'success' : 'neutral'}>
          {t(scheme.active ? 'catalogue.active' : 'catalogue.inactive')}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('schemes.title')} intro={t('schemes.intro')}>
        <Button
          variant="primary"
          icon={<Icon icon={Plus} />}
          onClick={() => void navigate({ to: '/settings/schemes/new' })}
        >
          {t('schemes.add')}
        </Button>
      </PageHeader>
      {schemes.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(schemes.error, t)}
        </p>
      ) : schemes.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('schemes.caption')}
          columns={columns}
          rows={schemes.data}
          rowKey={(scheme) => scheme.id}
          empty={
            <EmptyState icon={<Icon icon={BadgePercent} />} title={t('schemes.empty_title')}>
              {t('schemes.empty_body')}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
