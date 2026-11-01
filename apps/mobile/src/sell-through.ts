import type { Outbox, OutboxItem, SqlDatabase } from '@thelamp/api-client/sync';
import {
  newId,
  previousPeriod,
  type SaveSellThroughBody,
  type SellThroughFlag,
  type SellThroughLineBody,
  soldThrough,
  statementLineFlags,
  type StockLine,
  type SyncSellThrough,
} from '@thelamp/shared';
import { useMemo } from 'react';
import { useLocalRows } from './local-data';
import { useOutboxItems } from './sync';

/**
 * Sell-through on the phone (BR-53, decision D124): an account's monthly stock statement, kept
 * on the phone for this month and last, so last month's closing carries forward and a statement
 * saves offline. A save queues like any capture and is applied once by the version ID it carries.
 */

export const SELL_THROUGH_KIND = 'sell_through.save';

export interface QueuedStatement {
  accountId: string;
  period: string;
  body: SaveSellThroughBody;
}

export interface StatementLine extends StockLine {
  sold: string;
  flags: SellThroughFlag[];
}

export interface PhoneStatement {
  /** Each item's line: the latest the phone knows, saves still queued on top. */
  lines: Map<string, StatementLine>;
  /** Last month's closing by item, carried forward as this month's opening. */
  carried: Map<string, string>;
  /** Saves of this month still waiting to upload. */
  waiting: number;
}

/** The highest version the phone holds of an account's month. */
function latest(
  rows: readonly SyncSellThrough[],
  accountId: string,
  period: string,
): SyncSellThrough | undefined {
  return rows
    .filter((row) => row.accountId === accountId && row.period === period)
    .sort((a, b) => b.version - a.version)[0];
}

/** A line as the server would work it out: opening as sent, else the month's, else carried. */
export function lineFrom(
  sent: SellThroughLineBody,
  before: StockLine | undefined,
  carried: string | undefined,
): StatementLine {
  const stock = {
    opening: sent.opening ?? before?.opening ?? carried ?? '0',
    received: sent.received,
    returned: sent.returned,
    closing: sent.closing,
  };
  return { ...stock, sold: soldThrough(stock), flags: statementLineFlags(stock, carried ?? null) };
}

/** An account's month as the phone knows it, with queued saves applied in order. */
export function statementOf(
  rows: readonly SyncSellThrough[],
  queued: readonly QueuedStatement[],
  accountId: string,
  period: string,
): PhoneStatement {
  const before = latest(rows, accountId, previousPeriod(period));
  const carried = new Map(before?.lines.map((line) => [line.itemId, line.closing]) ?? []);
  const lines = new Map<string, StatementLine>(
    latest(rows, accountId, period)?.lines.map((line) => [line.itemId, line]) ?? [],
  );
  const mine = queued.filter((entry) => entry.accountId === accountId && entry.period === period);
  for (const save of mine) {
    for (const sent of save.body.lines) {
      lines.set(sent.itemId, lineFrom(sent, lines.get(sent.itemId), carried.get(sent.itemId)));
    }
  }
  return { lines, carried, waiting: mine.length };
}

/** Statements still on the phone, oldest first. */
export function queuedStatements(items: readonly OutboxItem[]): QueuedStatement[] {
  return items
    .filter((item) => item.kind === SELL_THROUGH_KIND)
    .map((item) => item.payload as QueuedStatement);
}

/** An account's month on the phone, undefined while its copy loads. */
export function useStatement(accountId: string, period: string): PhoneStatement | undefined {
  const rows = useLocalRows('sell_through');
  const items = useOutboxItems();
  return useMemo(
    () =>
      rows === undefined
        ? undefined
        : statementOf(rows, queuedStatements(items), accountId, period),
    [rows, items, accountId, period],
  );
}

/** Queues a save of the lines changed, as a new version with its own ID. */
export async function queueStatement(
  sync: { db: SqlDatabase; outbox: Outbox },
  owner: string,
  accountId: string,
  period: string,
  lines: readonly SellThroughLineBody[],
): Promise<string> {
  const id = newId();
  const payload: QueuedStatement = { accountId, period, body: { id, lines: [...lines] } };
  await sync.db.transaction(async (tx) => {
    await sync.outbox.enqueue(tx, { id, owner, kind: SELL_THROUGH_KIND, payload });
  });
  return id;
}
