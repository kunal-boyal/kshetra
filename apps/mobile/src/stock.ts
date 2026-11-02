import type { Outbox, OutboxItem, SqlDatabase } from '@thelamp/api-client/sync';
import {
  ledgerMonth,
  newId,
  type StockCountBody,
  stockShortfall,
  type SyncStock,
} from '@thelamp/shared';
import { useMemo } from 'react';
import { useLocalRows } from './local-data';
import { useOutboxItems } from './sync';

/**
 * Distributors' stock on the phone (BR-62, decision D130): what each account that holds stock has
 * of each item, kept on the phone so the account screen and a cart through it show stock offline.
 * A count queues like any capture, is applied once by its ID, and sets the phone's copy at once.
 */

export const STOCK_COUNT_KIND = 'stock.count';

export interface QueuedCount {
  body: StockCountBody;
}

/** An account's stock as the phone knows it: what synced, counts still queued laid over it. */
export function stockOf(
  rows: readonly SyncStock[],
  queued: readonly QueuedCount[],
  accountId: string,
): Map<string, string> {
  const row = rows.find((entry) => entry.accountId === accountId);
  const onHand = new Map(row?.items.map((item) => [item.itemId, item.onHand]) ?? []);
  for (const count of queued.filter((entry) => entry.body.accountId === accountId)) {
    for (const line of count.body.lines) onHand.set(line.itemId, line.counted);
  }
  return onHand;
}

/** Counts still on the phone, oldest first. */
export function queuedCounts(items: readonly OutboxItem[]): QueuedCount[] {
  return items
    .filter((item) => item.kind === STOCK_COUNT_KIND)
    .map((item) => item.payload as QueuedCount);
}

/** An account's stock on the phone by item, undefined while its copy loads. */
export function useAccountStock(accountId: string | null): Map<string, string> | undefined {
  const rows = useLocalRows('stock');
  const items = useOutboxItems();
  return useMemo(
    () =>
      rows === undefined || accountId === null
        ? undefined
        : stockOf(rows, queuedCounts(items), accountId),
    [rows, items, accountId],
  );
}

/**
 * What the ledger says came in and went back at an account in a month, by item, to pre-fill its
 * sell-through statement (BR-62); empty unless the app keeps stock there and the phone sees it.
 */
export function useLedgerMonth(
  accountId: string,
  period: string,
  kept: boolean,
): Map<string, { received: string; returned: string }> {
  const rows = useLocalRows('stock');
  return useMemo(() => {
    const row = kept ? rows?.find((entry) => entry.accountId === accountId) : undefined;
    return ledgerMonth(row?.items ?? [], period);
  }, [rows, accountId, period, kept]);
}

/** What a supplier lacks of a cart's lines, from the phone's copy of its stock (BR-62). */
export function cartShortfall(
  onHand: ReadonlyMap<string, string> | undefined,
  lines: readonly { itemId: string; baseUnits: string }[],
) {
  return onHand ? stockShortfall(lines, onHand) : [];
}

/** Queues a count with its own ID; it adjusts the server's ledger once it uploads. */
export async function queueCount(
  sync: { db: SqlDatabase; outbox: Outbox },
  owner: string,
  accountId: string,
  lines: readonly { itemId: string; counted: string }[],
): Promise<string> {
  const id = newId();
  const payload: QueuedCount = {
    body: { id, accountId, countedAt: new Date().toISOString(), lines: [...lines] },
  };
  await sync.db.transaction(async (tx) => {
    await sync.outbox.enqueue(tx, { id, owner, kind: STOCK_COUNT_KIND, payload });
  });
  return id;
}
