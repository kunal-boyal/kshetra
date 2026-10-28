import { type Paging, usePagedRows } from '@thelamp/ui-web';

interface PagedQuery {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

/**
 * Ten a page over a list the API pages by cursor (decision D104): Next asks for the server's next
 * page once it runs past the rows loaded. For lists that aren't a `DataTable`, which pages itself.
 */
export function useQueryPaging(count: number, query: PagedQuery, resetKey?: unknown): Paging {
  return usePagedRows(
    count,
    query.hasNextPage
      ? { onClick: () => void query.fetchNextPage(), busy: query.isFetchingNextPage }
      : undefined,
    resetKey,
  );
}
