import {
  type CreateExportBody,
  type ExportResult as ExportView,
  ExportListResult,
  ExportResult,
  type Locale,
  newId,
  type ReportFilters,
  type ReportKey,
  ReportPage,
} from '@thelamp/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WebClient } from '../client';
import { useApp } from '../context';
import { read } from '../people/data';

/** While a file is being made, the list asks again this often. */
const BUSY_POLL_MS = 2000;

/** The query string for a report's filters: only those set. */
function search(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.toString();
}

/** A report for a month, a page at a time, headings and coded values in the reader's language. */
export function useReport(key: ReportKey, filters: ReportFilters, locale: Locale, enabled = true) {
  const { client } = useApp();
  return useInfiniteQuery({
    enabled,
    queryKey: ['report', key, filters, locale],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/reports/${key}?${search({ ...filters, locale, limit: 50, cursor: pageParam })}`,
        ReportPage,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

const busy = (item: ExportView) => item.status === 'queued' || item.status === 'running';

/** The person's exports of the last days, read again while any is being made. */
export function useExports(enabled: boolean) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['exports'],
    queryFn: async () => (await read(client, '/v1/exports', ExportListResult)).items,
    enabled,
    refetchInterval: (query) => (query.state.data?.some(busy) ? BUSY_POLL_MS : false),
  });
}

/** Asks for a report as a file; the list shows it at once. */
export function useStartExport() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  return async (body: Omit<CreateExportBody, 'id'>) => {
    const id = newId();
    const started = await client.request('POST', '/v1/exports', ExportResult, {
      body: { id, ...body },
      idempotencyKey: newId(),
    });
    await queryClient.invalidateQueries({ queryKey: ['exports'] });
    return started;
  };
}

/** Opens an export's file through a fresh short-lived link. */
export async function download(client: WebClient, id: string): Promise<void> {
  const fresh = await read(client, `/v1/exports/${id}`, ExportResult);
  if (fresh.download) window.location.assign(fresh.download.url);
}
