import {
  type ImportResult as ImportView,
  ImportListResult,
  ImportResult,
  type ImportStatus,
  type ImportTarget,
  newId,
  type TenantPermission,
} from '@kshetra/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { WebClient } from '../client';
import { useApp } from '../context';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';

/** What each family of imports needs, besides `import.run` (M19). */
export const TARGET_PERMISSIONS: Record<'users' | 'territories' | 'accounts', TenantPermission> = {
  users: 'user.manage',
  territories: 'territory.manage',
  accounts: 'account.import',
};

export interface TargetChoice {
  value: ImportTarget;
  label: string;
}

/**
 * The targets, in the reader's words: people, territories, and each account type by its own
 * name (`accounts:<type>`, Appendix B.2). `allowed` holds the ones the person may import.
 */
export function useImportTargets() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const config = useConfig(client, queryClient);
  return useMemo(() => {
    const types = config.data?.bundle.accountTypes ?? [];
    const all: TargetChoice[] = [
      { value: 'users', label: t('imports.target_users') },
      { value: 'territories', label: t('imports.target_territories') },
      ...types.map((type) => ({
        value: `accounts:${type.key}` as const,
        label: type.name[locale].other,
      })),
    ];
    const family = (target: string) => target.split(':')[0] as keyof typeof TARGET_PERMISSIONS;
    const activeTypes = new Set(
      types.filter((type) => type.active).map((type) => `accounts:${type.key}`),
    );
    return {
      allowed: all.filter(
        (choice) =>
          access.can(TARGET_PERMISSIONS[family(choice.value)]) &&
          (family(choice.value) !== 'accounts' || activeTypes.has(choice.value)),
      ),
      name: (target: string) => all.find((choice) => choice.value === target)?.label ?? target,
    };
  }, [access, config.data, locale, t]);
}

/** While the worker has the import, the page asks again this often. */
const BUSY_POLL_MS = 1000;
const BUSY = ['reading', 'validating', 'committing'] as const satisfies ImportStatus[];

export const isBusy = (status: ImportStatus): status is (typeof BUSY)[number] =>
  (BUSY as readonly ImportStatus[]).includes(status);

/** The types the API takes; anything else goes as bytes, and the file's name decides. */
function typeOf(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return 'text/csv';
  if (name.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return 'application/octet-stream';
}

/** Sends the file itself as the body, with a fresh idempotency key (BR-46). */
export async function upload(client: WebClient, target: ImportTarget, file: File) {
  const query = new URLSearchParams({ target, fileName: file.name });
  const started = await client.request('POST', `/v1/imports?${query}`, ImportResult, {
    file: { data: file, type: typeOf(file) },
    idempotencyKey: newId(),
  });
  if (!started) throw new Error('The import answered without a body.');
  return started;
}

/** Earlier imports, newest first, a page at a time. */
export function useImports() {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['imports'],
    queryFn: ({ pageParam }) =>
      read(client, `/v1/imports${pageParam ? `?cursor=${pageParam}` : ''}`, ImportListResult),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One import, read again every second while the worker has it. */
export function useImport(id: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['import', id],
    queryFn: () => read(client, `/v1/imports/${id}`, ImportResult),
    refetchInterval: (query) =>
      query.state.data && isBusy(query.state.data.status) ? BUSY_POLL_MS : false,
  });
}

/** Shows an import's new state at once, and the history and what it loaded once it reads again. */
export function useImportChanged() {
  const queryClient = useQueryClient();
  return async (view: ImportView) => {
    queryClient.setQueryData(['import', view.id], view);
    await queryClient.invalidateQueries({ queryKey: ['imports'] });
  };
}
