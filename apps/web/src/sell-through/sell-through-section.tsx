import { formatDate, formatMonth, formatMoney, formatNumber } from '@thelamp/i18n';
import {
  monthEnd,
  SELL_THROUGH_GRACE_DAYS,
  type SellThroughLine,
  SellThroughResult,
  todayIn,
} from '@thelamp/shared';
import {
  Button,
  type Column,
  DataTable,
  Notice,
  PeriodStepper,
  StatusBadge,
} from '@thelamp/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';
import { Section, useDates } from '../people/shared';

/** The last day a month's statement may change (BR-53). */
function lastChange(period: string): string {
  const end = new Date(`${monthEnd(period)}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + SELL_THROUGH_GRACE_DAYS);
  return end.toISOString().slice(0, 10);
}

/**
 * An account's stock statements (BR-53, decision D124), in the template's word, such as
 * liquidation: a month's items with opening, received, returned, closing and what sold through,
 * valued at the account's prices, flagged where they don't add up, with every version kept.
 */
export function SellThroughSection({ accountId }: { accountId: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const [version, setVersion] = useState<number>();
  const shown = useQuery({
    queryKey: ['sell-through', accountId, period, version ?? 'latest'],
    queryFn: () =>
      read(
        client,
        version === undefined
          ? `/v1/accounts/${accountId}/sell-through?period=${period}`
          : `/v1/accounts/${accountId}/sell-through/${period}/versions/${version}`,
        SellThroughResult,
      ),
  });
  const money = (value: string) =>
    formatMoney(value as `${number}`, { locale, currency: access.currency });
  const quantity = (value: string) => formatNumber(Number(value), { locale });
  const data = shown.data;
  const statement = data?.statement ?? null;

  const columns: Column<SellThroughLine>[] = [
    {
      key: 'item',
      header: t('sell_through.col_item'),
      render: (line) => (
        <span className="flex flex-col">
          <span>{line.item.name}</span>
          <code className="ks-muted text-sm">{line.item.code}</code>
        </span>
      ),
    },
    {
      key: 'opening',
      header: t('report.col_opening'),
      align: 'end',
      render: (line) => quantity(line.opening),
    },
    {
      key: 'received',
      header: t('report.col_received'),
      align: 'end',
      render: (line) => quantity(line.received),
    },
    {
      key: 'returned',
      header: t('report.col_returned'),
      align: 'end',
      render: (line) => quantity(line.returned),
    },
    {
      key: 'closing',
      header: t('report.col_closing'),
      align: 'end',
      render: (line) => quantity(line.closing),
    },
    {
      key: 'sold',
      header: t('report.col_sold'),
      align: 'end',
      render: (line) => <strong>{quantity(line.sold)}</strong>,
    },
    {
      key: 'value',
      header: t('report.col_amount'),
      align: 'end',
      render: (line) => (line.value === null ? '—' : money(line.value)),
    },
    {
      key: 'flags',
      header: t('report.col_flags'),
      render: (line) =>
        line.flags.length === 0 ? (
          '—'
        ) : (
          <span className="flex flex-wrap gap-1">
            {line.flags.map((flag) => (
              <StatusBadge key={flag} variant={flag === 'negative_sold' ? 'danger' : 'pending'}>
                {t(`sell_through.flag_${flag}`)}
              </StatusBadge>
            ))}
          </span>
        ),
    },
  ];

  return (
    <Section title={t('sell_through.title')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodStepper
            value={period}
            onChange={(next) => {
              setPeriod(next);
              setVersion(undefined);
            }}
            format={(value) => formatMonth(value, { locale })}
            label={t('sell_through.month')}
            previousLabel={t('targets.previous_month')}
            nextLabel={t('targets.next_month')}
          />
          {data ? (
            <p className="ks-meta">
              {data.open
                ? t('sell_through.open_until', { date: formatDate(lastChange(period), { locale }) })
                : t('sell_through.closed')}
            </p>
          ) : null}
        </div>
        {shown.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(shown.error, t)}
          </p>
        ) : !data ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : !statement ? (
          <p className="ks-muted">{t('sell_through.none')}</p>
        ) : (
          <>
            {version !== undefined ? (
              <Notice>
                <span className="flex flex-wrap items-center gap-2">
                  {t('sell_through.showing_version', {
                    version,
                    count: data.versions.length,
                  })}
                  <Button size="sm" variant="ghost" onClick={() => setVersion(undefined)}>
                    {t('sell_through.show_latest')}
                  </Button>
                </span>
              </Notice>
            ) : null}
            {statement.value !== null ? (
              <p className="heading-sm">
                {t('sell_through.total', { value: money(statement.value) })}
              </p>
            ) : null}
            <DataTable
              caption={t('sell_through.title')}
              columns={columns}
              rows={statement.lines}
              rowKey={(line) => line.item.id}
            />
            <p className="ks-meta">{t('sell_through.carried')}</p>
            <details>
              <summary className="cursor-pointer font-semibold">
                {t('sell_through.versions')} ({data.versions.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {data.versions.map((entry, index) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {t('sell_through.version', {
                        version: entry.version,
                        name: entry.recordedBy.name,
                        at: dates.dateTime(entry.recordedAt),
                      })}
                    </span>
                    {index === 0 ? (
                      <StatusBadge variant="info">{t('sell_through.latest')}</StatusBadge>
                    ) : null}
                    {entry.version !== statement.version ? (
                      <Button size="sm" variant="ghost" onClick={() => setVersion(entry.version)}>
                        {t('sell_through.show_version', { version: entry.version })}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
    </Section>
  );
}
