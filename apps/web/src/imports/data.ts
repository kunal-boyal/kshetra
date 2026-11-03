import {
  type ImportResult as ImportView,
  ImportListResult,
  ImportResult,
  type ImportStatus,
  ImportTargetsResult,
  type ImportTarget,
  newId,
  type TenantPermission,
} from '@thelamp/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageKey } from '@thelamp/i18n';
import { useMemo } from 'react';
import type { WebClient } from '../client';
import { useApp } from '../context';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';

/** What each family of imports needs, besides `import.run` (M19). */
export const TARGET_PERMISSIONS: Record<
  | 'users'
  | 'territories'
  | 'accounts'
  | 'items'
  | 'targets'
  | 'account_plans'
  | 'finance_snapshots'
  | 'ledger_entries'
  | 'invoices'
  | 'receipts'
  | 'holidays'
  | 'external_metrics'
  | 'payroll_gross'
  | 'salary_structures'
  | 'sell_through'
  | 'forecasts'
  | 'stock_movements'
  | 'stock_levels',
  TenantPermission
> = {
  users: 'user.manage',
  territories: 'territory.manage',
  accounts: 'account.import',
  items: 'catalogue.manage',
  targets: 'target.edit',
  account_plans: 'account_plan.manage',
  finance_snapshots: 'finance.manage',
  ledger_entries: 'finance.manage',
  invoices: 'finance.manage',
  receipts: 'finance.manage',
  holidays: 'calendar.manage',
  external_metrics: 'metric.record',
  payroll_gross: 'payroll.manage',
  salary_structures: 'salary.manage',
  sell_through: 'sell_through.record',
  forecasts: 'forecast.record',
  stock_movements: 'stock.record',
  stock_levels: 'stock.record',
};

export interface TargetChoice {
  value: ImportTarget;
  label: string;
  /** The group the choice is listed under. */
  group: string;
}

type Family = keyof typeof TARGET_PERMISSIONS;

/** How the choices are grouped, and their order on the page (decision D139). */
const TARGET_GROUPS: readonly [MessageKey, readonly Family[]][] = [
  ['imports.group_organisation', ['users', 'territories', 'holidays']],
  ['imports.group_accounts', ['accounts']],
  ['imports.group_catalogue', ['items', 'stock_levels', 'stock_movements', 'sell_through']],
  ['imports.group_plans', ['targets', 'account_plans', 'forecasts', 'external_metrics']],
  ['imports.group_finance', ['finance_snapshots', 'ledger_entries', 'invoices', 'receipts']],
  ['imports.group_payroll', ['payroll_gross', 'salary_structures']],
];

const familyOf = (target: string) => target.split(':')[0] as Family;

/** What the caller may import now, as the server judges it (decision D139). */
export function useOfferedTargets() {
  const { client } = useApp();
  const access = useAccess();
  return useQuery({
    queryKey: ['import-targets'],
    queryFn: () => read(client, '/v1/imports/targets', ImportTargetsResult),
    enabled: access.can('import.run'),
  });
}

/**
 * The targets, in the reader's words and in groups: people, territories and holidays; each
 * account type by its own name (`accounts:<type>`, Appendix B.2); the catalogue and stock;
 * targets, plans and metric values; finance; payroll. `allowed` holds those the server offers
 * the person now (decision D139): their permissions, and each only where it can succeed, such as
 * stock levels only while stock comes from the books. `fromBooks` says a live ERP connection
 * writes a target too.
 */
export function useImportTargets() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const config = useConfig(client, queryClient);
  const offered = useOfferedTargets();
  return useMemo(() => {
    const types = config.data?.bundle.accountTypes ?? [];
    const typeName = new Map(types.map((type) => [type.key, type.name[locale].other]));
    const name = (target: string): string => {
      if (target.startsWith('accounts:')) {
        return typeName.get(target.slice('accounts:'.length)) ?? target;
      }
      return target in TARGET_PERMISSIONS ? t(`imports.target_${target}` as MessageKey) : target;
    };
    const items = offered.data?.items ?? [];
    const allowed: TargetChoice[] = TARGET_GROUPS.flatMap(([group, families]) =>
      families.flatMap((family) =>
        items
          .filter((item) => familyOf(item.target) === family)
          .map((item) => ({ value: item.target, label: name(item.target), group: t(group) })),
      ),
    );
    const books = new Set(items.filter((item) => item.fromBooks).map((item) => item.target));
    return {
      allowed,
      name,
      fromBooks: (target: ImportTarget) => books.has(target),
    };
  }, [config.data, offered.data, locale, t]);
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
