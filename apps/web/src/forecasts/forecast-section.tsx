import { formatMonth, formatNumber } from '@thelamp/i18n';
import {
  FORECAST_MONTHS,
  type ForecastMonth,
  ForecastResult,
  newId,
  shiftPeriod,
  StockQuantity,
  todayIn,
} from '@thelamp/shared';
import {
  Button,
  type Column,
  DataTable,
  Icon,
  PeriodStepper,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useCatalogue } from '../catalogue/data';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { fieldErrors, Section, useDates } from '../people/shared';
import { keepWhileSame } from '../query-keep';

type Line = ForecastMonth['lines'][number];

/**
 * An account's forecast by item (BR-54, decision D126): the expected quantities for a month, kept
 * as versions. A month is open until it begins; after that only someone who may change locked
 * forecasts does, saying why. Each save keeps the items it doesn't name; 0 takes one out.
 */
export function ForecastSection({ accountId }: { accountId: string }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const thisMonth = todayIn(access.timezone).slice(0, 7);
  const [period, setPeriod] = useState(() => shiftPeriod(thisMonth, 1));
  const shown = useQuery({
    queryKey: ['forecasts', accountId, period],
    placeholderData: keepWhileSame(['forecasts', accountId, period], [2]),
    queryFn: () =>
      read(
        client,
        `/v1/accounts/${accountId}/forecasts?from=${period}&to=${period}`,
        ForecastResult,
      ),
  });
  const month = shown.data?.months[0];
  const editable =
    access.can('forecast.record') &&
    period >= thisMonth &&
    (month?.open === true || access.can('forecast.adjust'));
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number>();
  const [failure, setFailure] = useState<unknown>();
  const catalogue = useCatalogue();
  const errors = fieldErrors(failure);
  const quantity = (value: string) => formatNumber(Number(value), { locale });
  const wrong = Object.values(drafts).some(
    (value) => value.trim() !== '' && !StockQuantity.safeParse(value.trim()).success,
  );

  function reset() {
    setEditing(false);
    setDrafts({});
    setAdded([]);
    setReason('');
    setFailure(undefined);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const lines = Object.entries(drafts)
      .filter(([, value]) => value.trim() !== '')
      .map(([itemId, value]) => ({ itemId, quantity: value.trim().replace(/,/g, '') }));
    if (lines.length === 0) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const result = await write(
        client,
        'PUT',
        `/v1/accounts/${accountId}/forecasts/${period}`,
        ForecastResult,
        { id: newId(), lines, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      );
      queryClient.setQueryData(['forecasts', accountId, period], result);
      reset();
      setSaved(result?.months[0]?.versions[0]?.version);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const items = catalogue.data?.items ?? [];
  const known = new Set([...(month?.lines ?? []).map((line) => line.item.id), ...added]);
  const rows: Line[] = [
    ...(month?.lines ?? []),
    ...added.flatMap((itemId) => {
      const item = items.find((entry) => entry.id === itemId);
      return item
        ? [
            {
              item: { id: item.id, code: item.code, name: item.name, baseUnit: item.baseUnit },
              quantity: '',
            },
          ]
        : [];
    }),
  ];
  const columns: Column<Line>[] = [
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
      key: 'quantity',
      header: t('forecast.quantity'),
      align: 'end',
      render: (line) =>
        editing ? (
          <input
            className="ks-input num max-w-32"
            aria-label={t('forecast.quantity_of', { name: line.item.name })}
            inputMode="decimal"
            value={drafts[line.item.id] ?? ''}
            placeholder={line.quantity}
            onChange={(event) =>
              setDrafts((current) => ({ ...current, [line.item.id]: event.target.value }))
            }
          />
        ) : (
          `${quantity(line.quantity)} ${line.item.baseUnit}`
        ),
    },
  ];

  return (
    <Section title={t('forecast.title')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodStepper
            value={period}
            onChange={(next) => {
              setPeriod(next);
              reset();
              setSaved(undefined);
            }}
            min={shiftPeriod(thisMonth, -11)}
            max={shiftPeriod(thisMonth, FORECAST_MONTHS)}
            format={(value) => formatMonth(value, { locale })}
            label={t('forecast.month')}
            previousLabel={t('targets.previous_month')}
            nextLabel={t('targets.next_month')}
          />
          {month ? (
            <StatusBadge variant={month.open ? 'info' : 'neutral'}>
              {month.open ? t('forecast.month_open') : t('forecast.month_locked')}
            </StatusBadge>
          ) : null}
        </div>
        {saved !== undefined ? (
          <p role="status">{t('forecast.saved', { version: saved })}</p>
        ) : null}
        {shown.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(shown.error, t)}
          </p>
        ) : !month ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
            {rows.length === 0 ? (
              <p className="ks-muted">{t('forecast.none')}</p>
            ) : (
              <DataTable
                caption={t('forecast.title')}
                columns={columns}
                rows={rows}
                rowKey={(line) => line.item.id}
              />
            )}
            {editing ? (
              <>
                <SelectField
                  label={t('forecast.add_item')}
                  className="max-w-sm"
                  value=""
                  none={t('forecast.choose_item')}
                  options={items
                    .filter((item) => item.active && !known.has(item.id))
                    .map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }))}
                  onChange={(event) => {
                    const itemId = event.target.value;
                    if (itemId) setAdded((current) => [...current, itemId]);
                  }}
                />
                {!month.open ? (
                  <TextField
                    label={t('forecast.reason')}
                    value={reason}
                    required
                    {...(errors.reason ? { error: errors.reason } : {})}
                    onChange={(event) => setReason(event.target.value)}
                  />
                ) : null}
                {wrong ? <p className="ks-help error">{t('forecast.quantity_issue')}</p> : null}
                {failure && !errors.reason ? (
                  <p className="ks-help error" role="alert">
                    {errorMessage(failure, t)}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    icon={<Icon icon={Save} />}
                    busy={busy}
                    disabled={
                      wrong ||
                      Object.values(drafts).every((value) => value.trim() === '') ||
                      (!month.open && !reason.trim())
                    }
                  >
                    {t('forecast.save')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={reset}>
                    {t('forecast.cancel')}
                  </Button>
                </div>
              </>
            ) : editable ? (
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                onClick={() => {
                  setEditing(true);
                  setSaved(undefined);
                }}
              >
                {t('forecast.edit')}
              </Button>
            ) : null}
          </form>
        )}
        {month && month.versions.length > 0 ? (
          <details>
            <summary className="cursor-pointer font-semibold">
              {t('forecast.versions')} ({month.versions.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {month.versions.map((entry) => (
                <li key={entry.id} className="flex flex-col">
                  <span>
                    {t('forecast.version', {
                      version: entry.version,
                      name: entry.recordedBy.name,
                      at: dates.dateTime(entry.recordedAt),
                    })}
                  </span>
                  {entry.afterLock && entry.reason ? (
                    <span className="ks-meta">
                      {t('forecast.after_lock', { reason: entry.reason })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Section>
  );
}
