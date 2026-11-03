import type { OutboxItem, Outbox, SqlDatabase } from '@thelamp/api-client/sync';
import type { MessageKey } from '@thelamp/i18n';
import {
  type AccountInvoiceRow,
  type CollectionStatusKey,
  collectedNotInBooks,
  collectionPreview,
  type RecordCollectionBody,
  scaled,
  type SyncBalance,
  type SyncCollection,
  todayIn,
  unscaled,
} from '@thelamp/shared';
import { useMemo } from 'react';
import { useLocalRows } from './local-data';
import { useOutboxItems } from './sync';

/**
 * Collections on the phone (M11, BR-63, decision D132): money taken from an account in the field,
 * recorded offline with its own ID and queued like any capture. The phone keeps its person's own
 * collections and every one not yet in the books at the accounts it sees, so what an account owes
 * after them, and the cash it has given that day, read the same with or without signal.
 */

export const COLLECTION_KIND = 'collection.create';

/** A collection as the phone knows it: synced, or still waiting to upload (`number` null). */
export interface PhoneCollection {
  id: string;
  number: string | null;
  accountId: string;
  /** Null for one still on the phone, which is always its person's own. */
  userId: string | null;
  collectedOn: string;
  collectedAt: string;
  amount: string;
  mode: SyncCollection['mode'];
  reference: string | null;
  chequeNumber: string | null;
  chequeBank: string | null;
  chequeDate: string | null;
  status: CollectionStatusKey;
  reason: string | null;
  queued: boolean;
}

/** Collections still on the phone, oldest first. */
export function queuedCollections(items: readonly OutboxItem[]): RecordCollectionBody[] {
  return items
    .filter((item) => item.kind === COLLECTION_KIND)
    .map((item) => item.payload as RecordCollectionBody);
}

/**
 * What synced and what is queued, as one list, newest first. A queued collection counts as
 * recorded on the day it was taken, as the server will record it; once it syncs back, the synced
 * row stands in for it.
 */
export function phoneCollections(
  rows: readonly SyncCollection[],
  queued: readonly RecordCollectionBody[],
  timezone: string,
): PhoneCollection[] {
  const synced = new Set(rows.map((row) => row.id));
  return [
    ...rows.map((row) => ({ ...row, queued: false })),
    ...queued
      .filter((body) => !synced.has(body.id))
      .map((body) => ({
        id: body.id,
        number: null,
        accountId: body.accountId,
        userId: null,
        collectedOn: todayIn(timezone, new Date(body.collectedAt)),
        collectedAt: body.collectedAt,
        amount: body.amount,
        mode: body.mode,
        reference: body.reference,
        chequeNumber: body.chequeNumber,
        chequeBank: body.chequeBank,
        chequeDate: body.chequeDate,
        status: 'recorded' as const,
        reason: null,
        queued: true,
      })),
  ].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
}

/** Every collection the phone knows, undefined while its copy loads. */
export function useCollections(timezone: string): PhoneCollection[] | undefined {
  const rows = useLocalRows('collections');
  const items = useOutboxItems();
  return useMemo(
    () =>
      rows === undefined ? undefined : phoneCollections(rows, queuedCollections(items), timezone),
    [rows, items, timezone],
  );
}

/** The person's own: queued ones and those synced as theirs. */
export function mine(collections: readonly PhoneCollection[], userId: string | undefined) {
  return collections.filter((entry) => entry.queued || entry.userId === userId);
}

/**
 * Cash already taken from the account that day, as the server counts it for the limit (BR-63):
 * recorded, confirmed or in the books.
 */
export function cashThatDay(
  collections: readonly PhoneCollection[],
  accountId: string,
  day: string,
): string {
  return unscaled(
    collections
      .filter(
        (entry) =>
          entry.accountId === accountId &&
          entry.collectedOn === day &&
          entry.mode === 'cash' &&
          (entry.status === 'recorded' ||
            entry.status === 'confirmed' ||
            entry.status === 'in_books'),
      )
      .reduce((sum, entry) => sum + scaled(entry.amount, 2), 0n),
    2,
  );
}

/**
 * What the account owes by the books, collected but not yet in the books, and what is left after
 * it (BR-63), from the phone's balance and collections; null without a balance.
 */
export function accountCollected(
  balance: SyncBalance | null | undefined,
  collections: readonly PhoneCollection[],
  accountId: string,
): { outstanding: string; notInBooks: string; leftAfter: string } | null {
  if (!balance) return null;
  const here = collections.filter((entry) => entry.accountId === accountId);
  return { outstanding: balance.outstanding, ...collectedNotInBooks(balance.outstanding, here) };
}

/** What of the account's open invoices is past due, read online; null while they aren't known. */
export function overdueOf(invoices: readonly AccountInvoiceRow[] | undefined): string | null {
  if (!invoices) return null;
  return unscaled(
    invoices
      .filter((invoice) => invoice.daysPastDue !== null && invoice.daysPastDue > 0)
      .reduce((sum, invoice) => sum + scaled(invoice.open, 2), 0n),
    2,
  );
}

/**
 * Which open invoices a new amount would settle, oldest first, after the collections at the
 * account not yet in the books (BR-63): a preview from the invoices read online, never stored.
 */
export function settlesFirst(
  invoices: readonly AccountInvoiceRow[],
  collections: readonly PhoneCollection[],
  accountId: string,
  amount: string,
) {
  return collectionPreview({
    // What is still open of each, as the books' receipts already settled the rest.
    invoices: invoices
      .filter((invoice) => !invoice.cancelled && scaled(invoice.open, 2) > 0n)
      .map((invoice) => ({ ...invoice, amount: invoice.open })),
    receipts: [],
    pending: collections
      .filter(
        (entry) =>
          entry.accountId === accountId &&
          (entry.status === 'recorded' || entry.status === 'confirmed'),
      )
      .map((entry) => ({ amount: entry.amount, collectedOn: entry.collectedOn })),
    amount,
  });
}

/**
 * Queues a collection with its own ID, after its cheque photos and the check-in of the visit it
 * was taken on, so the server finds both when it arrives.
 */
export async function queueCollection(
  sync: { db: SqlDatabase; outbox: Outbox },
  owner: string,
  body: RecordCollectionBody,
): Promise<void> {
  const after = [...body.photos, ...(body.visitId ? [body.visitId] : [])];
  await sync.db.transaction(async (tx) => {
    await sync.outbox.enqueue(tx, {
      id: body.id,
      owner,
      kind: COLLECTION_KIND,
      payload: body,
      ...(after.length > 0 ? { dependsOn: after } : {}),
    });
  });
}

/** How it was paid, in words: the mode and its reference or cheque. */
export function paidBy(
  collection: Pick<PhoneCollection, 'mode' | 'reference' | 'chequeNumber' | 'chequeBank'>,
  mode: string,
): string {
  if (collection.mode === 'cheque') {
    return [`${mode} ${collection.chequeNumber ?? ''}`.trim(), collection.chequeBank]
      .filter(Boolean)
      .join(' · ');
  }
  return [mode, collection.reference].filter(Boolean).join(' · ');
}

type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

/**
 * The receipt the shop owner is sent through the share sheet (decision D132): what was received,
 * from whom, how and by whom, and, until the office confirms it, that it awaits the office. Money
 * turned down gives no receipt.
 */
export function receiptMessage(
  collection: Pick<
    PhoneCollection,
    'number' | 'amount' | 'mode' | 'reference' | 'chequeNumber' | 'chequeBank' | 'status'
  > & { date: string },
  account: { name: string; code: string },
  collector: string | null,
  t: Translate,
  money: (amount: string) => string,
): string | null {
  if (collection.status === 'rejected' || collection.status === 'bounced') return null;
  return [
    collection.number
      ? t('collections.receipt_title', { number: collection.number })
      : t('collections.receipt_heading'),
    t('collections.receipt_body', {
      amount: money(collection.amount),
      account: account.name,
      code: account.code,
      date: collection.date,
      paid: paidBy(collection, t(`collections.mode_${collection.mode}`)),
    }),
    collector ? t('collections.receipt_by', { name: collector }) : null,
    collection.status === 'recorded' ? t('collections.receipt_waiting') : null,
  ]
    .filter(Boolean)
    .join('\n');
}
