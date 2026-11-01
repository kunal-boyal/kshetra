import { localRows, type Outbox, type SqlDatabase, type Visits } from '@thelamp/api-client/sync';
import {
  newId,
  type PlaceOrderBody,
  type PriceRounding,
  priceLine,
  type PricedLine,
  type QuotedFree,
  scaled,
  type SchemeAccount,
  schemeCart,
  type SyncAccount,
  type SyncScheme,
  type SyncTerritory,
  todayIn,
  unscaled,
} from '@thelamp/shared';
import { useMemo } from 'react';
import { useConfig } from './data';
import { useLocalRows } from './local-data';
import type { Fix } from './location';
import { type ItemPrice, pricesAt, territoriesAbove } from './prices';
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
  /** As the server will price it: after the line's scheme, once `withSchemes()` applied it. */
  values: PricedLine;
  /** The line's scheme (BR-55), and what it took off its taxable. */
  scheme: { key: string; name: SyncScheme['name']; discount: string } | null;
}

/** What schemes are judged by for an account on a day (BR-55, decision D127). */
export interface SchemeContext {
  schemes: readonly SyncScheme[];
  account: SchemeAccount;
  day: string;
}

/** A cart with its schemes applied, and the goods they give free. */
export interface SchemedCart {
  lines: PricedCartLine[];
  free: QuotedFree[];
}

/**
 * A quantity stepped by one in its unit, as a decimal string without trailing zeros: 2.5 steps to
 * 3.5 and 1.5. Null once it would fall below one part of a unit, when the line leaves the cart.
 */
export function stepQuantity(quantity: string, by: 1 | -1): string | null {
  const next = scaled(quantity, 3) + BigInt(by) * 1000n;
  if (next <= 0n) return null;
  return unscaled(next, 3).replace(/\.?0+$/, '');
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
        scheme: null,
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

/** The account as schemes judge it, from the phone's copy of the territories. */
export function schemeAccount(
  account: SyncAccount,
  territories: readonly SyncTerritory[],
): SchemeAccount {
  return { type: account.type, territories: territoriesAbove(account.territoryId, territories) };
}

/**
 * BR-55: each line's scheme as the server will choose it, its discount taken off the line's
 * taxable before tax, and the goods given free, valued for the choice at each free item's rate.
 */
export function withSchemes(
  lines: readonly PricedCartLine[],
  offers: readonly ItemPrice[],
  context: SchemeContext | null,
): SchemedCart {
  if (!context) return { lines: [...lines], free: [] };
  const rates = new Map(offers.map((offer) => [offer.item.id, offer.rate]));
  const cart = schemeCart(
    lines.map((line) => ({
      line,
      itemId: line.itemId,
      categoryId: line.offer.item.category?.id ?? null,
      baseUnits: line.values.baseUnits,
      taxable: line.values.taxable,
      taxRate: line.offer.item.taxRate,
      tax: line.values.tax,
      total: line.values.total,
    })),
    context.schemes,
    context.account,
    context.day,
    (itemId) => rates.get(itemId) ?? null,
  );
  return {
    lines: cart.lines.map((entry) => ({
      ...entry.line,
      values: { ...entry.line.values, taxable: entry.taxable, tax: entry.tax, total: entry.total },
      scheme: entry.chosen
        ? {
            key: entry.chosen.scheme.key,
            name: context.schemes.find((scheme) => scheme.id === entry.chosen!.scheme.id)!.name,
            discount: entry.schemeDiscount,
          }
        : null,
    })),
    free: cart.free,
  };
}

/** The schemes that judge an account's cart today; null while the phone's copy loads. */
export function useSchemeContext(account: SyncAccount | undefined): SchemeContext | null {
  const config = useConfig();
  const schemes = useLocalRows('schemes');
  const territories = useLocalRows('territories');
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  return useMemo(() => {
    if (!account || !schemes || !territories) return null;
    return {
      schemes,
      account: schemeAccount(account, territories),
      day: todayIn(timeZone),
    };
  }, [account, schemes, territories, timeZone]);
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
      scheme: line.scheme ? { key: line.scheme.key, discount: line.scheme.discount } : null,
    },
  }));
}

/** The order as the API takes it, with the open visit at this account, if there is one. */
export async function orderBody(
  sync: Pick<Ready, 'visits'>,
  owner: string,
  input: {
    accountId: string;
    lines: readonly PricedCartLine[];
    free: readonly QuotedFree[];
    note: string;
    fix: Fix;
  },
): Promise<PlaceOrderBody> {
  const visit = await sync.visits.current(owner);
  return {
    id: newId(),
    accountId: input.accountId,
    visitId: visit && visit.accountId === input.accountId ? visit.visitId : null,
    lines: quotedLines(input.lines),
    free: [...input.free],
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
  context: SchemeContext | null = null,
): Promise<boolean> {
  const cart = withSchemes(priceCart(body.lines, offers, rounding), offers, context);
  if (cart.lines.length === 0) return false;
  await sync.outbox.replace(id, { ...body, lines: quotedLines(cart.lines), free: cart.free });
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
  const [accounts, lists, prices, items, territories, schemes] = await Promise.all([
    localRows(sync.db, 'accounts'),
    localRows(sync.db, 'price_lists'),
    localRows(sync.db, 'prices'),
    localRows(sync.db, 'items'),
    localRows(sync.db, 'territories'),
    localRows(sync.db, 'schemes'),
  ]);
  const account = accounts.find((entry) => entry.id === body.accountId);
  if (!account) return false;
  const offers = pricesAt(account, { lists, prices, items, territories }, today);
  return priceAgain(sync, id, body, offers, rounding, {
    schemes,
    account: schemeAccount(account, territories),
    day: today,
  });
}
