import { formatMonth, formatNumber } from '@thelamp/i18n';
import {
  COLLECTION_STATUSES,
  type CollectionResult,
  type CollectionStatusKey,
  scaled,
  todayIn,
  unscaled,
} from '@thelamp/shared';
import {
  Button,
  Checkbox,
  type Column,
  Confirm,
  DataTable,
  EmptyState,
  FilterChips,
  Icon,
  PageHeader,
  PeriodStepper,
  SplitDetail,
  StatTile,
  TextField,
} from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { Check, HandCoins, X } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { useDates } from '../people/shared';
import {
  ChequePhoto,
  CollectionActions,
  CollectionBadge,
  CollectionFacts,
  paidBy,
  useMoney,
} from './collection-parts';
import { useCollection, useCollections, useCollectionWrites } from './collections-data';

/**
 * Collections (M11, BR-63, decision D132): the money the field took in a month, newest first,
 * with what waits for the office, what isn't in the books yet and what was turned down. The office
 * confirms or rejects several at once, and works one at a time beside the list.
 */
export function CollectionsPage() {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const money = useMoney();
  const n = (value: number) => formatNumber(value, { locale });
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  // The office starts with what waits for it; others with every collection.
  const [chosenStatus, setStatus] = useState<CollectionStatusKey | null>();
  const status =
    chosenStatus === undefined
      ? access.can('collection.confirm')
        ? 'recorded'
        : null
      : chosenStatus;
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const collections = useCollections({ period, ...(status ? { status } : {}) }, access.ready);
  const rows = collections.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = collections.data?.pages[0]?.summary ?? null;
  const chosen = rows.find((row) => row.id === chosenId) ?? rows[0] ?? null;
  const decidable = rows.filter((row) => row.can.decide);
  const picked = decidable.filter((row) => selected.has(row.id));

  const sum = (...keys: CollectionStatusKey[]) =>
    unscaled(
      keys.reduce((total, key) => total + scaled(summary?.amounts[key] ?? '0', 2), 0n),
      2,
    );
  const count = (...keys: CollectionStatusKey[]) =>
    keys.reduce((total, key) => total + (summary?.counts[key] ?? 0), 0);

  const columns: Column<CollectionResult>[] = [
    ...(decidable.length > 0
      ? [
          {
            key: 'pick',
            header: t('collections.select'),
            render: (row: CollectionResult) =>
              row.can.decide ? (
                <Checkbox
                  label={t('collections.select')}
                  aria-label={t('collections.select_one', { number: row.number })}
                  checked={selected.has(row.id)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(row.id);
                    else next.delete(row.id);
                    setSelected(next);
                  }}
                />
              ) : null,
          } satisfies Column<CollectionResult>,
        ]
      : []),
    {
      key: 'number',
      header: t('collections.col_number'),
      render: (row) => (
        <button
          type="button"
          className="ks-cell-link"
          aria-pressed={row.id === chosen?.id}
          onClick={() => setChosenId(row.id)}
        >
          <code>{row.number}</code>
        </button>
      ),
    },
    {
      key: 'date',
      header: t('collections.col_date'),
      align: 'num',
      render: (row) => <span className="whitespace-nowrap">{dates.date(row.collectedOn)}</span>,
    },
    {
      key: 'account',
      header: t('collections.col_account'),
      render: (row) => <span className="font-semibold">{row.account.name}</span>,
    },
    { key: 'by', header: t('collections.col_collector'), render: (row) => row.collector.name },
    { key: 'mode', header: t('collections.paid_by'), render: (row) => paidBy(row, t) },
    {
      key: 'amount',
      header: t('collections.amount'),
      align: 'end',
      render: (row) => money(row.amount),
    },
    {
      key: 'status',
      header: t('collections.col_status'),
      render: (row) => <CollectionBadge status={row.status} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('collections.title')}
        meta={formatMonth(period, { locale })}
        toolbar={
          <>
            <FilterChips<CollectionStatusKey>
              label={t('collections.col_status')}
              value={status}
              onChange={(next) => {
                setStatus(next);
                setChosenId(null);
                setSelected(new Set());
              }}
              clearable
              formatCount={n}
              choices={COLLECTION_STATUSES.map((entry) => ({
                value: entry,
                label: t(`collections.status_${entry}`),
                ...(summary ? { count: summary.counts[entry] ?? 0 } : {}),
              }))}
            />
            <PeriodStepper
              value={period}
              onChange={(next) => {
                setPeriod(next);
                setChosenId(null);
                setSelected(new Set());
              }}
              format={(value) => formatMonth(value, { locale })}
              label={t('plan.month')}
              previousLabel={t('targets.previous_month')}
              nextLabel={t('targets.next_month')}
            />
          </>
        }
      />
      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label={t('collections.tile_waiting')}
            value={money(sum('recorded'))}
            sub={t('collections.tile_count', { count: count('recorded'), n: n(count('recorded')) })}
          />
          <StatTile
            label={t('collections.tile_not_in_books')}
            value={money(sum('recorded', 'confirmed'))}
            sub={t('collections.tile_not_in_books_sub')}
          />
          <StatTile
            label={t('collections.tile_in_books')}
            value={money(sum('in_books'))}
            sub={t('collections.tile_count', { count: count('in_books'), n: n(count('in_books')) })}
          />
          <StatTile
            label={t('collections.tile_turned_down')}
            value={money(sum('rejected', 'bounced'))}
            sub={t('collections.tile_turned_down_sub', {
              rejected: n(count('rejected')),
              bounced: n(count('bounced')),
            })}
            {...(count('rejected', 'bounced') > 0 ? { tone: 'danger' as const } : {})}
          />
        </div>
      ) : null}
      {decidable.length > 1 ? (
        <Together
          rows={decidable}
          picked={picked}
          onPick={(ids) => setSelected(new Set(ids))}
          onDone={() => setSelected(new Set())}
        />
      ) : null}
      {collections.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(collections.error, t)}
        </p>
      ) : collections.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Icon icon={HandCoins} />} title={t('collections.empty_title')}>
          {t('collections.empty_body')}
        </EmptyState>
      ) : (
        <SplitDetail
          detailLabel={chosen ? chosen.number : t('collections.title')}
          list={
            <DataTable
              caption={t('collections.caption')}
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              selectedKey={chosen?.id ?? null}
              {...(collections.hasNextPage
                ? {
                    more: {
                      busy: collections.isFetchingNextPage,
                      onClick: () => void collections.fetchNextPage(),
                    },
                  }
                : {})}
            />
          }
          detail={chosen ? <CollectionPreview key={chosen.id} id={chosen.id} /> : null}
        />
      )}
    </div>
  );
}

/**
 * Confirming or rejecting the chosen collections at once (BR-63): each is decided on its own, so
 * one refused leaves the rest decided, and the refusals are counted.
 */
function Together({
  rows,
  picked,
  onPick,
  onDone,
}: {
  rows: readonly CollectionResult[];
  picked: readonly CollectionResult[];
  onPick: (ids: string[]) => void;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const writes = useCollectionWrites();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [outcome, setOutcome] = useState<{ done: number; refused: number }>();

  async function decide(decision: 'confirm' | 'reject') {
    setBusy(true);
    setFailure(undefined);
    setOutcome(undefined);
    try {
      const { results } = await writes.decide(
        picked.map((row) => ({
          id: row.id,
          decision,
          ...(decision === 'reject' ? { reason: reason.trim() } : {}),
        })),
      );
      const refused = results.filter((result) => result.error).length;
      setOutcome({ done: results.length - refused, refused });
      setRejecting(false);
      setReason('');
      onDone();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="ks-card flex flex-col gap-3"
      role="group"
      aria-label={t('collections.together')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox
          label={t('collections.select_all', { count: rows.length })}
          checked={picked.length === rows.length}
          onChange={(event) => onPick(event.target.checked ? rows.map((row) => row.id) : [])}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            busy={busy && !rejecting}
            disabled={picked.length === 0}
            icon={<Icon icon={Check} />}
            onClick={() => void decide('confirm')}
          >
            {t('collections.confirm_selected', { count: picked.length })}
          </Button>
          <Button
            variant="secondary"
            disabled={picked.length === 0}
            icon={<Icon icon={X} />}
            onClick={() => setRejecting(true)}
          >
            {t('collections.reject_selected', { count: picked.length })}
          </Button>
        </div>
      </div>
      {rejecting ? (
        <Confirm
          question={t('collections.reject_selected_question', { count: picked.length })}
          action={
            <Button
              variant="danger"
              busy={busy}
              disabled={reason.trim().length < 3}
              onClick={() => void decide('reject')}
            >
              {t('collections.reject')}
            </Button>
          }
          cancel={
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              {t('common.cancel')}
            </Button>
          }
        >
          <TextField
            label={t('collections.why')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Confirm>
      ) : null}
      {outcome ? (
        <p className="ks-help" role="status">
          {t('collections.together_done', { count: outcome.done })}
          {outcome.refused > 0
            ? ` ${t('collections.together_refused', { count: outcome.refused })}`
            : ''}
        </p>
      ) : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
    </div>
  );
}

/** The chosen collection beside the list: what it says, its cheque, and what the office may do. */
function CollectionPreview({ id }: { id: string }) {
  const { t } = useLanguage();
  const collection = useCollection(id);
  if (collection.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(collection.error, t)}
      </p>
    );
  }
  if (!collection.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const data = collection.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="ks-spread items-start gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="heading-lg">{data.number}</h2>
          <p className="ks-meta">
            {data.account.name} · {data.account.code}
          </p>
        </div>
        <CollectionBadge status={data.status} />
      </div>
      <CollectionFacts collection={data} />
      {data.photos.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {data.photos.map((photo, index) => (
            <ChequePhoto key={photo} id={photo} index={index} />
          ))}
        </div>
      ) : null}
      <CollectionActions collection={data} />
      <Link
        to="/collections/$collectionId"
        params={{ collectionId: data.id }}
        className="ks-btn secondary sm self-start"
      >
        {t('collections.open')}
      </Link>
    </div>
  );
}
