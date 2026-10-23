import { localRows, type Outbox, type SqlDatabase, type Visits } from '@thelamp/api-client/sync';
import {
  newId,
  type PlaceOrderBody,
  type PriceRounding,
  priceLine,
  type PricedLine,
} from '@thelamp/shared';
import type { Fix } from './location';
import { type ItemPrice, pricesAt } from './prices';
import { captureFix } from './visits';

/**
 * Orders on the phone (M10, decision D78): a cart priced with the server's own functions from the
 * phone's price lists, placed with a fix and the open visit at the account, and queued to send in
 * one transaction, offline too. An order the server refuses because prices changed waits in the
 * upload queue until it is priced again.
 */

interface Ready {
  db: SqlDatabase;
  outbox: Outbox;
  visits: Visits;
}

/** A line as the person entered it: an item, the unit it is sold in, and how many. */
export interface CartLine {
  itemId: string;
  unitKey: string;
  quantity: string;
}

export interface PricedCartLine extends CartLine {
  offer: ItemPrice;
  factor: string;
  values: PricedLine;
}

/** Each line priced as the server will price it; lines the account has no price for drop. */
export function priceCart(
  lines: readonly CartLine[],
  offers: readonly ItemPrice[],
  rounding: PriceRounding,
): PricedCartLine[] {
  const byItem = new Map(offers.map((offer) => [offer.item.id, offer]));
  return lines.flatMap((line) => {
    const offer = byItem.get(line.itemId);
    const unit = offer?.item.units.find((entry) => entry.key === line.unitKey);
    if (!offer || !unit) return [];
    return [
      {
        ...line,
        offer,
        factor: unit.factor,
        values: priceLine(
          {
            price: offer.price,
            discount: offer.discount,
            taxRate: offer.item.taxRate,
            quantity: line.quantity,
            factor: unit.factor,
            measurePerBaseUnit: offer.item.measurePerBaseUnit,
          },
          rounding,
        ),
      },
    ];
  });
}

/** The lines as the order carries them: what the phone showed for each (BR-14). */
function quotedLines(lines: readonly PricedCartLine[]): PlaceOrderBody['lines'] {
  return lines.map((line) => ({
    itemId: line.itemId,
    unitKey: line.unitKey,
    quantity: line.quantity,
    quoted: {
      listId: line.offer.list.id,
      price: line.offer.price,
      discount: line.offer.discount,
      taxRate: line.offer.item.taxRate,
      factor: line.factor,
    },
  }));
}

/** The order as the API takes it, with the open visit at this account, if there is one. */
export async function orderBody(
  sync: Pick<Ready, 'visits'>,
  owner: string,
  input: { accountId: string; lines: readonly PricedCartLine[]; note: string; fix: Fix },
): Promise<PlaceOrderBody> {
  const visit = await sync.visits.current(owner);
  return {
    id: newId(),
    accountId: input.accountId,
    visitId: visit && visit.accountId === input.accountId ? visit.visitId : null,
    lines: quotedLines(input.lines),
    note: input.note.trim() || null,
    photos: [],
    fix: captureFix(input.fix),
    placedAt: new Date().toISOString(),
  };
}

/** Queues an order to send, after its visit's check-in when it was taken in a visit. */
export async function queueOrder(sync: Ready, owner: string, body: PlaceOrderBody): Promise<void> {
  await sync.db.transaction(async (tx) => {
    await sync.outbox.enqueue(tx, {
      id: body.id,
      owner,
      kind: 'order.place',
      payload: body,
      ...(body.visitId ? { dependsOn: [body.visitId] } : {}),
    });
  });
}

/**
 * An order refused because prices changed, priced again from the phone's current lists and
 * queued under the same ID. Lines the account can no longer order are left out; with none left,
 * nothing is queued and it says so.
 */
export async function priceAgain(
  sync: Pick<Ready, 'outbox'>,
  id: string,
  body: PlaceOrderBody,
  offers: readonly ItemPrice[],
  rounding: PriceRounding,
): Promise<boolean> {
  const lines = priceCart(body.lines, offers, rounding);
  if (lines.length === 0) return false;
  await sync.outbox.replace(id, { ...body, lines: quotedLines(lines) });
  return true;
}

/**
 * The upload queue's "Price again" for an order refused because prices changed: worked out
 * from what the phone keeps now. False when the account can no longer order any of its items.
 */
export async function repriceRefused(
  sync: Ready,
  id: string,
  body: PlaceOrderBody,
  rounding: PriceRounding,
  today: string,
): Promise<boolean> {
  const [accounts, lists, prices, items, territories] = await Promise.all([
    localRows(sync.db, 'accounts'),
    localRows(sync.db, 'price_lists'),
    localRows(sync.db, 'prices'),
    localRows(sync.db, 'items'),
    localRows(sync.db, 'territories'),
  ]);
  const account = accounts.find((entry) => entry.id === body.accountId);
  if (!account) return false;
  const offers = pricesAt(account, { lists, prices, items, territories }, today);
  return priceAgain(sync, id, body, offers, rounding);
}
