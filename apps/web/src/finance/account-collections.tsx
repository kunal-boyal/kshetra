import { type AccountFinanceResult, scaled } from '@thelamp/shared';
import { StatTile } from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { useDates } from '../people/shared';
import { CollectionBadge, paidBy, useMoney } from './collection-parts';
import { useCollections } from './collections-data';

/** How many of the account's latest collections its page lists. */
const RECENT = 5;

/**
 * An account's collections in its Finance section (BR-63, decision D132): what the field collected
 * that the books don't show yet, what is left owing after it, and the latest collections.
 */
export function AccountCollections({
  accountId,
  collected,
}: {
  accountId: string;
  collected: AccountFinanceResult['collected'] | undefined;
}) {
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const money = useMoney();
  const allowed = access.can('collection.view') || access.can('collection.record');
  const recent = useCollections({ accountId }, allowed);
  if (!allowed || access.modulesOff.includes('account_finance')) return null;
  const rows = (recent.data?.pages[0]?.items ?? []).slice(0, RECENT);
  return (
    <div className="flex flex-col gap-3">
      <h3 className="heading-sm">{t('collections.title')}</h3>
      {collected && scaled(collected.notInBooks, 2) > 0n ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile
            label={t('collections.not_in_books')}
            value={money(collected.notInBooks)}
            sub={t('collections.not_in_books_sub')}
          />
          {collected.leftAfter !== null ? (
            <StatTile
              label={t('collections.left_after')}
              value={money(collected.leftAfter)}
              sub={t('collections.left_after_sub')}
            />
          ) : null}
        </div>
      ) : null}
      {recent.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(recent.error, t)}
        </p>
      ) : recent.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="ks-muted">{t('collections.none_here')}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t('collections.recent')}>
          {rows.map((row) => (
            <li key={row.id} className="ks-spread flex-wrap items-center gap-3">
              <span className="flex min-w-0 flex-col">
                <Link
                  to="/collections/$collectionId"
                  params={{ collectionId: row.id }}
                  className="ks-cell-link"
                >
                  {row.number}
                </Link>
                <span className="ks-meta">
                  {dates.date(row.collectedOn)} · {paidBy(row, t)} · {row.collector.name}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <b>{money(row.amount)}</b>
                <CollectionBadge status={row.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
