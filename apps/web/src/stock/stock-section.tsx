import { formatMoney, formatNumber } from '@thelamp/i18n';
import {
  newId,
  RECORDED_MOVEMENT_KINDS,
  type RecordedMovementKind,
  type StockCountResult,
  type StockLevel,
  type StockMovementResult,
} from '@thelamp/shared';
import {
  Button,
  type Column,
  DataTable,
  Notice,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { type FormEvent, useState } from 'react';
import { useCatalogue } from '../catalogue/data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { fieldErrors, Section, useDates } from '../people/shared';
import { useStock, useStockCounts, useStockMovements, useStockWrites } from './data';

interface DraftLine {
  itemId: string;
  quantity: string;
}

/**
 * An account's stock (BR-62, decision D130): what it holds of each item, valued at its prices,
 * and, by permission, recording goods in or out (while the app keeps stock) and counting it; with
 * its movements and counts below. Negative stock is shown as it is, never hidden.
 */
export function StockSection({ accountId }: { accountId: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const stock = useStock(accountId);
  const [mode, setMode] = useState<'record' | 'count' | null>(null);
  const money = (value: string) =>
    formatMoney(value as `${number}`, { locale, currency: access.currency });
  const quantity = (value: string) => formatNumber(value as `${number}`, { locale });
  const data = stock.data;
  const kept = data?.source === 'kept';

  const columns: Column<StockLevel>[] = [
    {
      key: 'item',
      header: t('stock.col_item'),
      render: (level) => (
        <span className="flex flex-col">
          <span>{level.item.name}</span>
          <code className="ks-muted text-sm">{level.item.code}</code>
        </span>
      ),
    },
    {
      key: 'on_hand',
      header: t('stock.col_on_hand'),
      align: 'end',
      render: (level) =>
        level.onHand.startsWith('-') ? (
          <span className="flex items-center justify-end gap-2">
            <StatusBadge variant="danger">{t('stock.negative')}</StatusBadge>
            {`${quantity(level.onHand)} ${level.item.baseUnit}`}
          </span>
        ) : (
          `${quantity(level.onHand)} ${level.item.baseUnit}`
        ),
    },
    {
      key: 'value',
      header: t('stock.col_value'),
      align: 'end',
      render: (level) => (level.value === null ? '—' : money(level.value)),
    },
    {
      key: 'moved',
      header: t('stock.col_moved'),
      render: (level) => (level.movedAt ? dates.dateTime(level.movedAt) : '—'),
    },
    {
      key: 'counted',
      header: t('stock.col_counted'),
      render: (level) => (level.countedOn ? dates.date(level.countedOn) : '—'),
    },
  ];

  return (
    <Section title={t('stock.title')}>
      <div className="flex flex-col gap-4">
        {stock.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(stock.error, t)}
          </p>
        ) : !data ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="ks-meta">{t(kept ? 'stock.source_kept' : 'stock.source_books')}</p>
              <div className="flex flex-wrap gap-2">
                {kept && access.can('stock.record') ? (
                  <Button
                    size="sm"
                    variant={mode === 'record' ? 'primary' : 'secondary'}
                    onClick={() => setMode(mode === 'record' ? null : 'record')}
                  >
                    {t('stock.record')}
                  </Button>
                ) : null}
                {access.can('stock.count') ? (
                  <Button
                    size="sm"
                    variant={mode === 'count' ? 'primary' : 'secondary'}
                    onClick={() => setMode(mode === 'count' ? null : 'count')}
                  >
                    {t('stock.count')}
                  </Button>
                ) : null}
              </div>
            </div>
            {mode === 'record' ? (
              <RecordForm accountId={accountId} onDone={() => setMode(null)} />
            ) : null}
            {mode === 'count' ? (
              <CountForm
                accountId={accountId}
                held={data.items}
                kept={kept}
                onDone={() => setMode(null)}
              />
            ) : null}
            {data.value !== null ? (
              <p className="heading-sm">{t('stock.total', { value: money(data.value) })}</p>
            ) : null}
            <DataTable
              caption={t('stock.title')}
              columns={columns}
              rows={data.items}
              rowKey={(level) => level.item.id}
              empty={<p className="ks-muted">{t('stock.none')}</p>}
            />
            <Movements accountId={accountId} />
            <Counts accountId={accountId} />
          </>
        )}
      </div>
    </Section>
  );
}

/** Lines of items and quantities, each item once, from the catalogue's active items. */
function LinesEditor({
  lines,
  onChange,
  label,
  errors,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  label: string;
  errors: Record<string, string>;
}) {
  const { t } = useLanguage();
  const catalogue = useCatalogue();
  const items = (catalogue.data?.items ?? [])
    .filter((item) => item.active)
    .sort((a, b) => a.name.localeCompare(b.name));
  const set = (index: number, patch: Partial<DraftLine>) =>
    onChange(lines.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="ks-label">{t('stock.items')}</legend>
      {lines.map((line, index) => (
        <div key={index} className="flex flex-wrap items-end gap-2">
          <SelectField
            label={t('stock.item')}
            value={line.itemId}
            error={errors[`lines.${index}.itemId`]}
            onChange={(event) => set(index, { itemId: event.target.value })}
            options={[
              { value: '', label: t('stock.choose_item') },
              ...items.map((item) => ({
                value: item.id,
                label: `${item.name} (${item.code})`,
              })),
            ]}
          />
          <TextField
            label={label}
            inputMode="decimal"
            value={line.quantity}
            error={errors[`lines.${index}.quantity`] ?? errors[`lines.${index}.counted`]}
            onChange={(event) => set(index, { quantity: event.target.value })}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(lines.filter((_, at) => at !== index))}
          >
            {t('stock.remove_line', { n: index + 1 })}
          </Button>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChange([...lines, { itemId: '', quantity: '' }])}
        >
          {t('stock.add_line')}
        </Button>
      </div>
    </fieldset>
  );
}

/** Goods in or out by hand, or a correction, while the app keeps stock; once by its ID. */
function RecordForm({ accountId, onDone }: { accountId: string; onDone: () => void }) {
  const { t } = useLanguage();
  const writes = useStockWrites(accountId);
  const [id] = useState(() => newId());
  const [kind, setKind] = useState<RecordedMovementKind>('received');
  const [occurredOn, setOccurredOn] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: '', quantity: '' }]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await writes.record({
        id,
        accountId,
        kind,
        ...(occurredOn ? { occurredOn } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        lines: lines
          .filter((line) => line.itemId || line.quantity.trim())
          .map((line) => ({ itemId: line.itemId, quantity: line.quantity.trim() })),
      });
      onDone();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const errors = failure ? fieldErrors(failure) : {};
  return (
    <form
      className="flex max-w-2xl flex-col gap-3"
      aria-label={t('stock.record')}
      onSubmit={(event) => void save(event)}
      noValidate
    >
      <div className="flex flex-wrap gap-3">
        <SelectField
          label={t('stock.kind')}
          value={kind}
          onChange={(event) => setKind(event.target.value as RecordedMovementKind)}
          options={RECORDED_MOVEMENT_KINDS.map((key) => ({
            value: key,
            label: t(`stock.kind_${key}`),
          }))}
        />
        <TextField
          label={t('stock.date')}
          help={t('stock.date_help')}
          type="date"
          value={occurredOn}
          error={errors.occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
        />
      </div>
      <LinesEditor
        lines={lines}
        onChange={setLines}
        label={t(kind === 'corrected' ? 'stock.change' : 'stock.quantity')}
        errors={errors}
      />
      <TextField
        label={t('stock.note')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {failure && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={busy}>
          {t('stock.save')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

/**
 * A count of what is there, items left empty not counted. While the app keeps stock it sets each
 * item at once; a difference past the tolerance comes back flagged for a second look.
 */
function CountForm({
  accountId,
  held,
  kept,
  onDone,
}: {
  accountId: string;
  held: readonly StockLevel[];
  kept: boolean;
  onDone: () => void;
}) {
  const { t, locale } = useLanguage();
  const writes = useStockWrites(accountId);
  const [id] = useState(() => newId());
  const [lines, setLines] = useState<DraftLine[]>(() =>
    held.length > 0
      ? held.map((level) => ({ itemId: level.item.id, quantity: '' }))
      : [{ itemId: '', quantity: '' }],
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [result, setResult] = useState<StockCountResult>();

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      const counted = await writes.count({
        id,
        accountId,
        ...(note.trim() ? { note: note.trim() } : {}),
        lines: lines
          .filter((line) => line.itemId && line.quantity.trim())
          .map((line) => ({ itemId: line.itemId, counted: line.quantity.trim() })),
      });
      if (counted) setResult(counted);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const flagged = result.lines.filter((line) => line.flags.length > 0);
    return (
      <div className="flex flex-col gap-2">
        <p role="status">{t(kept ? 'stock.counted_kept' : 'stock.counted_books')}</p>
        {flagged.length > 0 ? (
          <Notice>
            {t('stock.count_flagged', {
              items: flagged
                .map(
                  (line) =>
                    `${line.item.name}: ${formatNumber(line.counted as `${number}`, { locale })} / ${formatNumber(line.expected as `${number}`, { locale })}`,
                )
                .join('; '),
            })}
          </Notice>
        ) : null}
        <div>
          <Button size="sm" variant="secondary" onClick={onDone}>
            {t('stock.done')}
          </Button>
        </div>
      </div>
    );
  }

  const errors = failure ? fieldErrors(failure) : {};
  return (
    <form
      className="flex max-w-2xl flex-col gap-3"
      aria-label={t('stock.count')}
      onSubmit={(event) => void save(event)}
      noValidate
    >
      <p className="ks-help">{t('stock.count_help')}</p>
      <LinesEditor lines={lines} onChange={setLines} label={t('stock.counted')} errors={errors} />
      <TextField
        label={t('stock.note')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {failure && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!lines.some((line) => line.itemId && line.quantity.trim())}
        >
          {t('stock.save_count')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** The account's movements, newest first, with what moved each. */
function Movements({ accountId }: { accountId: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const movements = useStockMovements(accountId);
  const rows = movements.data?.pages.flatMap((page) => page.items) ?? [];
  const columns: Column<StockMovementResult>[] = [
    { key: 'date', header: t('stock.col_date'), render: (move) => dates.date(move.occurredOn) },
    {
      key: 'item',
      header: t('stock.col_item'),
      render: (move) => `${move.item.name} (${move.item.code})`,
    },
    { key: 'kind', header: t('stock.col_kind'), render: (move) => t(`stock.kind_${move.kind}`) },
    {
      key: 'units',
      header: t('stock.col_quantity'),
      align: 'end',
      render: (move) =>
        `${move.units.startsWith('-') ? '' : '+'}${formatNumber(move.units as `${number}`, { locale })}`,
    },
    {
      key: 'source',
      header: t('stock.col_source'),
      render: (move) =>
        [t(`stock.source_${move.source.type}`), move.note].filter(Boolean).join(' · '),
    },
    { key: 'by', header: t('stock.col_by'), render: (move) => move.by?.name ?? '—' },
  ];
  return (
    <details>
      <summary className="cursor-pointer font-semibold">{t('stock.movements')}</summary>
      <div className="mt-2">
        {movements.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(movements.error, t)}
          </p>
        ) : (
          <DataTable
            caption={t('stock.movements')}
            columns={columns}
            rows={rows}
            rowKey={(move) => move.id}
            empty={<p className="ks-muted">{t('stock.movements_none')}</p>}
            {...(movements.hasNextPage
              ? {
                  more: {
                    onClick: () => void movements.fetchNextPage(),
                    busy: movements.isFetchingNextPage,
                  },
                }
              : {})}
          />
        )}
      </div>
    </details>
  );
}

/** The account's counts, newest first, each with what it found and its flags. */
function Counts({ accountId }: { accountId: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const counts = useStockCounts(accountId);
  const rows = counts.data?.pages.flatMap((page) => page.items) ?? [];
  const number = (value: string) => formatNumber(value as `${number}`, { locale });
  return (
    <details>
      <summary className="cursor-pointer font-semibold">{t('stock.counts')}</summary>
      <div className="mt-2 flex flex-col gap-3">
        {counts.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(counts.error, t)}
          </p>
        ) : rows.length === 0 ? (
          <p className="ks-muted">{t('stock.counts_none')}</p>
        ) : (
          rows.map((count) => (
            <article
              key={count.id}
              className="flex flex-col gap-1"
              aria-label={dates.dateTime(count.countedAt)}
            >
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {count.by
                  ? t('stock.count_by', {
                      at: dates.dateTime(count.countedAt),
                      name: count.by.name,
                    })
                  : dates.dateTime(count.countedAt)}
                {count.flagged ? (
                  <StatusBadge variant="pending">{t('stock.flagged')}</StatusBadge>
                ) : null}
              </p>
              <ul className="ks-help flex flex-col gap-0.5">
                {count.lines.map((line) => (
                  <li key={line.item.id}>
                    {t('stock.count_line', {
                      item: line.item.name,
                      counted: number(line.counted),
                      expected: number(line.expected),
                    })}
                    {line.flags.map((flag) => ` · ${t(`stock.flag_${flag}`)}`).join('')}
                  </li>
                ))}
              </ul>
            </article>
          ))
        )}
      </div>
    </details>
  );
}
