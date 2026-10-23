import {
  CatalogueResult,
  type ItemBody,
  ItemResult,
  type PriceListBody,
  PriceListItemsResult,
  PriceListListResult,
  PriceListResult,
} from '@thelamp/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context';
import { read, write } from '../people/data';

/** The catalogue as the phones hold it: units, measures and every item. */
export function useCatalogue() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['catalogue'],
    queryFn: () => read(client, '/v1/catalogue', CatalogueResult),
  });
}

export function usePriceLists() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['price-lists'],
    queryFn: async () => (await read(client, '/v1/price-lists', PriceListListResult)).items,
  });
}

export function usePriceList(id: string | undefined) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['price-lists', id],
    queryFn: () => read(client, `/v1/price-lists/${id}`, PriceListResult),
    enabled: id !== undefined,
  });
}

/** A list's prices by item code, a page at a time, narrowed by code or name. */
export function usePriceListItems(id: string, q: string) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['price-lists', id, 'items', q],
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '50' });
      if (q) query.set('q', q);
      if (pageParam) query.set('cursor', pageParam);
      return read(client, `/v1/price-lists/${id}/items?${query}`, PriceListItemsResult);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Changes to items and prices; the catalogue and the lists read again after. */
export function useCatalogueWrites() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['catalogue'] }),
      queryClient.invalidateQueries({ queryKey: ['price-lists'] }),
    ]);
  return {
    async saveItem(id: string, body: Omit<ItemBody, 'custom'> & { custom?: ItemBody['custom'] }) {
      const item = await write(client, 'PUT', `/v1/items/${id}`, ItemResult, body);
      await refresh();
      return item;
    },
    async saveList(
      id: string,
      body: Partial<PriceListBody> & Pick<PriceListBody, 'name' | 'scope' | 'validFrom'>,
    ) {
      const list = await write(client, 'PUT', `/v1/price-lists/${id}`, PriceListResult, body);
      await refresh();
      return list;
    },
    async setPrices(
      id: string,
      body: {
        set?: { itemId: string; price: string; discount?: string }[];
        remove?: string[];
        version: number;
      },
    ) {
      const list = await write(client, 'PUT', `/v1/price-lists/${id}/items`, PriceListResult, body);
      await refresh();
      return list;
    },
  };
}
