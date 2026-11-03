import type { Outbox, OutboxItem, SqlDatabase } from '@thelamp/api-client/sync';
import {
  type ForecastLineBody,
  newId,
  type SaveForecastBody,
  scaled,
  type SyncForecast,
} from '@thelamp/shared';
import { useMemo } from 'react';
import { useLocalRows } from './local-data';
import { useOutboxItems } from './sync';

/**
 * Forecasts on the phone (BR-54, decision D126): an account's expected quantity by item for this
 * month and the next three, kept on the phone so a forecast is read and changed offline. A save
 * queues like any capture and is applied once by the version ID it carries.
 */

export const FORECAST_KIND = 'forecast.save';

export interface QueuedForecast {
  accountId: string;
  period: string;
  body: SaveForecastBody;
}

export interface PhoneForecast {
  /** Each item's quantity: the latest the phone knows, saves still queued on top. */
  quantities: Map<string, string>;
  /** Saves of this month still waiting to upload. */
  waiting: number;
}

/** An account's month as the phone knows it: the highest version, queued saves applied in order. */
export function forecastOf(
  rows: readonly SyncForecast[],
  queued: readonly QueuedForecast[],
  accountId: string,
  period: string,
): PhoneForecast {
  const latest = rows
    .filter((row) => row.accountId === accountId && row.period === period)
    .sort((a, b) => b.version - a.version)[0];
  const quantities = new Map(latest?.lines.map((line) => [line.itemId, line.quantity]) ?? []);
  const mine = queued.filter((entry) => entry.accountId === accountId && entry.period === period);
  for (const save of mine) {
    for (const line of save.body.lines) {
      // As the server merges: 0 takes the item out.
      if (scaled(line.quantity, 3) === 0n) quantities.delete(line.itemId);
      else quantities.set(line.itemId, line.quantity);
    }
  }
  return { quantities, waiting: mine.length };
}

/** Forecasts still on the phone, oldest first. */
export function queuedForecasts(items: readonly OutboxItem[]): QueuedForecast[] {
  return items
    .filter((item) => item.kind === FORECAST_KIND)
    .map((item) => item.payload as QueuedForecast);
}

/** An account's month on the phone, undefined while its copy loads. */
export function useForecast(accountId: string, period: string): PhoneForecast | undefined {
  const rows = useLocalRows('forecasts');
  const items = useOutboxItems();
  return useMemo(
    () =>
      rows === undefined ? undefined : forecastOf(rows, queuedForecasts(items), accountId, period),
    [rows, items, accountId, period],
  );
}

/**
 * Queues a save of the items changed, as a new version with its own ID and the moment it was
 * saved, by which the server judges the month's lock (decision D136).
 */
export async function queueForecast(
  sync: { db: SqlDatabase; outbox: Outbox },
  owner: string,
  accountId: string,
  period: string,
  lines: readonly ForecastLineBody[],
): Promise<string> {
  const id = newId();
  const payload: QueuedForecast = {
    accountId,
    period,
    body: { id, lines: [...lines], savedAt: new Date().toISOString() },
  };
  await sync.db.transaction(async (tx) => {
    await sync.outbox.enqueue(tx, { id, owner, kind: FORECAST_KIND, payload });
  });
  return id;
}
