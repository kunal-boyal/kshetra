import { scaled, unscaled } from './pricing';

/**
 * Distributors' stock (module M24, BR-62, decision D130): the rules of the ledger a tenant's app
 * keeps, or the levels its books load. Quantities are base units to three places, signed where a
 * movement takes stock away; nothing here values stock.
 */

/** What moved stock: an opening, goods in or out, a count's adjustment, or a correction. */
export const STOCK_MOVEMENT_KINDS = [
  'opening',
  'received',
  'sold',
  'returned_in',
  'returned_out',
  'counted',
  'corrected',
] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

/** The kinds a person or a file records by hand; the rest come from fulfilment and counts. */
export const RECORDED_MOVEMENT_KINDS = [
  'opening',
  'received',
  'sold',
  'returned_in',
  'returned_out',
  'corrected',
] as const satisfies readonly StockMovementKind[];
export type RecordedMovementKind = (typeof RECORDED_MOVEMENT_KINDS)[number];

/** Whether a kind takes stock away; `corrected` and `counted` carry their own sign. */
export function movementSign(kind: StockMovementKind): 1 | -1 | 0 {
  if (kind === 'sold' || kind === 'returned_out') return -1;
  if (kind === 'counted' || kind === 'corrected') return 0;
  return 1;
}

/** A signed decimal string (`-2.5`) at three places, as an integer. */
export function stockUnits(text: string): bigint {
  const trimmed = text.trim();
  return trimmed.startsWith('-') ? -scaled(trimmed.slice(1), 3) : scaled(trimmed, 3);
}

/** An integer at three places as the plainest decimal string: `12`, `-2.5`. */
export function stockUnitsText(value: bigint): string {
  const negative = value < 0n;
  const text = unscaled(negative ? -value : value, 3).replace(/\.?0+$/, '');
  return negative && text !== '0' ? `-${text}` : text || '0';
}

/** A movement's signed units, from the quantity a person writes (always positive but for corrections). */
export function signedUnits(kind: StockMovementKind, quantity: string): string {
  const sign = movementSign(kind);
  return sign === -1 ? stockUnitsText(-stockUnits(quantity)) : stockUnitsText(stockUnits(quantity));
}

/** On hand after a movement. */
export function onHandAfter(onHand: string, moved: string): string {
  return stockUnitsText(stockUnits(onHand) + stockUnits(moved));
}

/** One accepted line of an order as fulfilment left it, with what stock already moved for it. */
export interface FulfilledLine {
  lineId: string;
  itemId: string;
  /** Base units fulfilled so far. */
  fulfilled: string;
  /** Base units already moved for this line: into the buyer, and out of the supplier. */
  movedIn: string;
  movedOut: string;
}

export interface FulfilmentMovement {
  accountId: string;
  itemId: string;
  kind: 'received' | 'sold';
  /** Signed: received positive, sold negative. */
  units: string;
  /** The order line it comes from, its source. */
  lineId: string;
}

/**
 * The movements a fulfilment makes (BR-62): each line's units fulfilled since stock last moved
 * for it go into the buyer, if its type keeps stock, and out of the supplying account, if the
 * order is a secondary one and the supplier's type keeps stock. The company's own stock isn't
 * kept. Recording the same fulfilment again moves nothing more.
 */
export function movementsFromFulfilment(order: {
  buyer: { accountId: string; keepsStock: boolean };
  supplier: { accountId: string; keepsStock: boolean } | null;
  lines: readonly FulfilledLine[];
}): FulfilmentMovement[] {
  const movements: FulfilmentMovement[] = [];
  for (const line of order.lines) {
    const fulfilled = stockUnits(line.fulfilled);
    if (order.buyer.keepsStock) {
      const delta = fulfilled - stockUnits(line.movedIn);
      if (delta > 0n) {
        movements.push({
          accountId: order.buyer.accountId,
          itemId: line.itemId,
          kind: 'received',
          units: stockUnitsText(delta),
          lineId: line.lineId,
        });
      }
    }
    if (order.supplier?.keepsStock) {
      const delta = fulfilled - stockUnits(line.movedOut);
      if (delta > 0n) {
        movements.push({
          accountId: order.supplier.accountId,
          itemId: line.itemId,
          kind: 'sold',
          units: stockUnitsText(-delta),
          lineId: line.lineId,
        });
      }
    }
  }
  return movements;
}

export const COUNT_FLAGS = ['beyond_tolerance', 'was_negative'] as const;
export type CountFlag = (typeof COUNT_FLAGS)[number];

/**
 * A count against what the ledger expected (BR-62): the difference it adjusts by, flagged when it
 * is more than `tolerancePct` of what was expected (any difference when nothing was), or when the
 * ledger had fallen below zero. Counts adjust at once; flags only draw a manager's eye.
 */
export function countResult(
  expected: string,
  counted: string,
  tolerancePct: number,
): { difference: string; flags: CountFlag[] } {
  const before = stockUnits(expected);
  const difference = stockUnits(counted) - before;
  const flags: CountFlag[] = [];
  const size = difference < 0n ? -difference : difference;
  const base = before < 0n ? -before : before;
  // |difference| × 100 > base × tolerance, exactly.
  if (size > 0n && size * 100n > base * BigInt(tolerancePct)) flags.push('beyond_tolerance');
  if (before < 0n) flags.push('was_negative');
  return { difference: stockUnitsText(difference), flags };
}

/**
 * How far a cart runs past its supplier's stock (BR-62): each item's ordered base units, summed
 * across its lines, against what the supplier has on hand; items without a level count as none.
 * A short order is flagged, never refused.
 */
export function stockShortfall(
  lines: readonly { itemId: string; baseUnits: string }[],
  onHand: ReadonlyMap<string, string>,
): { itemId: string; ordered: string; onHand: string; short: string }[] {
  const ordered = new Map<string, bigint>();
  for (const line of lines) {
    ordered.set(line.itemId, (ordered.get(line.itemId) ?? 0n) + stockUnits(line.baseUnits));
  }
  return [...ordered].flatMap(([itemId, wanted]) => {
    const have = stockUnits(onHand.get(itemId) ?? '0');
    const available = have > 0n ? have : 0n;
    if (wanted <= available) return [];
    return [
      {
        itemId,
        ordered: stockUnitsText(wanted),
        onHand: stockUnitsText(have),
        short: stockUnitsText(wanted - available),
      },
    ];
  });
}
