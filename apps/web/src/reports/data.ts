import {
  type CreateReportScheduleBody,
  type CreateExportBody,
  type ExportResult as ExportView,
  ExportListResult,
  ExportResult,
  type Locale,
  newId,
  type ReportFilters,
  type ReportKey,
  ReportPage,
  ReportScheduleDetail,
  ReportScheduleListResult,
  ReportScheduleResult,
  type UpdateReportScheduleBody,
} from '@thelamp/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WebClient } from '../client';
import { useApp } from '../context';
import { read, write } from '../people/data';
import { keepWhileSame } from '../query-keep';

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
    placeholderData: keepWhileSame(['report', key, filters, locale], [2, 3]),
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

/** One export of the person's, such as the one a scheduled report's email links to (D122). */
export function useExport(id: string | undefined) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['export', id],
    queryFn: () => read(client, `/v1/exports/${id}`, ExportResult),
    enabled: id !== undefined,
  });
}

/** Scheduled reports (decision D122): the person's own, or those sent to them. */
export function useSchedules(whose: 'owner' | 'me', enabled: boolean) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['report-schedules', whose],
    queryFn: async () =>
      (await read(client, `/v1/report-schedules?for=${whose}`, ReportScheduleListResult)).items,
    enabled,
  });
}

/** One of the person's schedules, with its latest sends. */
export function useSchedule(id: string | undefined) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['report-schedule', id],
    queryFn: () => read(client, `/v1/report-schedules/${id}`, ReportScheduleDetail),
    enabled: id !== undefined,
  });
}

/** Making, changing, ending and leaving schedules; each refreshes the lists. */
export function useScheduleChanges() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const settle = async <T>(work: Promise<T>) => {
    const result = await work;
    await queryClient.invalidateQueries({ queryKey: ['report-schedules'] });
    await queryClient.invalidateQueries({ queryKey: ['report-schedule'] });
    return result;
  };
  return {
    create: (body: Omit<CreateReportScheduleBody, 'id'>) =>
      settle(
        write(client, 'POST', '/v1/report-schedules', ReportScheduleResult, {
          id: newId(),
          ...body,
        }),
      ),
    update: (id: string, body: UpdateReportScheduleBody) =>
      settle(write(client, 'PUT', `/v1/report-schedules/${id}`, ReportScheduleResult, body)),
    end: (id: string) =>
      settle(write(client, 'POST', `/v1/report-schedules/${id}/end`, ReportScheduleResult)),
    leave: (id: string) =>
      settle(write(client, 'POST', `/v1/report-schedules/${id}/leave`, ReportScheduleResult)),
  };
}
