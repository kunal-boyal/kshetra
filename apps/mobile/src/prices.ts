import {
  applicableLists,
  netRate,
  type PriceEntry,
  priceFor,
  type SyncAccount,
  type SyncItem,
  type SyncPrice,
  type SyncPriceList,
  type SyncTerritory,
  todayIn,
} from '@thelamp/shared';
import { useMemo } from 'react';
import { useConfig } from './data';
import { useLocalRows } from './local-data';

export interface ItemPrice {
  item: SyncItem;
  price: string;
  discount: string;
  /** BR-10: the net rate per base unit. */
  rate: string;
  list: SyncPriceList;
}

/** What the phone keeps that prices are worked out from. */
export interface PriceData {
  lists: readonly SyncPriceList[];
  prices: readonly SyncPrice[];
  items: readonly SyncItem[];
  territories: readonly SyncTerritory[];
}

/**
 * What each active item costs at an account on a day (spec 5.11, decision D77), from the phone's
 * own copy of the price lists, worked out with the server's functions: the most specific list
 * that applies first, and each item from the first list that prices it.
 */
export function pricesAt(account: SyncAccount, data: PriceData, day: string): ItemPrice[] {
  // The account's territory, then each one above it.
  const parents = new Map(data.territories.map((node) => [node.id, node.parentId]));
  const above: string[] = [];
  for (let at: string | null | undefined = account.territoryId; at; at = parents.get(at)) {
    if (above.includes(at)) break;
    above.push(at);
  }
  const applying = applicableLists(
    data.lists,
    { id: account.id, type: account.type, segments: account.segments, territories: above },
    day,
  );
  const entries = new Map<string, PriceEntry>();
  for (const entry of data.prices) {
    if (!entry.removed) entries.set(`${entry.priceListId}:${entry.itemId}`, entry);
  }
  const byId = new Map(applying.map((list) => [list.id, list]));
  return data.items
    .filter((item) => item.active)
    .flatMap((item) => {
      const found = priceFor(item.id, applying, (listId, itemId) =>
        entries.get(`${listId}:${itemId}`),
      );
      return found
        ? [
            {
              item,
              price: found.price,
              discount: found.discount,
              rate: netRate(found.price, found.discount),
              list: byId.get(found.listId)!,
            },
          ]
        : [];
    })
    .sort((a, b) => a.item.name.localeCompare(b.item.name));
}

/** What each active item costs at an account today; undefined while the phone's copy loads. */
export function useAccountPrices(account: SyncAccount | undefined): ItemPrice[] | undefined {
  const config = useConfig();
  const lists = useLocalRows('price_lists');
  const prices = useLocalRows('prices');
  const items = useLocalRows('items');
  const territories = useLocalRows('territories');
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  return useMemo(() => {
    if (!account || !lists || !prices || !items || !territories) return undefined;
    return pricesAt(account, { lists, prices, items, territories }, todayIn(timeZone));
  }, [account, lists, prices, items, territories, timeZone]);
}
