import { ApiError } from '@thelamp/api-client';
import { SETTING_DEFAULTS, type TenantPermission } from '@thelamp/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { expect, vi } from 'vitest';
import type { WebClient } from './client';
import { LanguageProvider } from './i18n';
import { createAppRouter } from './router';

/** Screen tests: a signed-in admin's client that answers from fixed pages and handlers. */

export const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: '',
};
export const ADMIN = '01a10000-0000-7000-8000-000000000002';

export const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });

export interface RequestOptions {
  body?: unknown;
  file?: { data: Blob; type: string };
  idempotencyKey?: string;
}

type Answer = (options: RequestOptions) => unknown;

/** GETs answer from `pages` by path, then by bare path; writes from `writes` by method and path. */
export function fakeClient(
  pages: Record<string, unknown>,
  writes: Record<string, Answer> = {},
  permissions: readonly TenantPermission[] = [],
  /** More of the config bundle, such as account types. */
  bundle: Record<string, unknown> = {},
) {
  const request = vi.fn(
    async (method: string, path: string, _schema: unknown, options: RequestOptions = {}) => {
      const bare = path.split('?')[0]!;
      if (method === 'GET') {
        const page = pages[path] ?? pages[bare];
        if (page === undefined) throw new ApiError(404, 'NOT_FOUND', `Nothing at ${path}`);
        return typeof page === 'function' ? (page as () => unknown)() : page;
      }
      const answer = writes[`${method} ${bare}`];
      if (!answer) throw new ApiError(404, 'NOT_FOUND', `Nothing at ${method} ${path}`);
      return answer(options);
    },
  );
  return {
    request,
    file: vi.fn<(path: string) => Promise<Blob>>(
      async () => new Blob(['%PDF-1.3'], { type: 'application/pdf' }),
    ),
    session: { tenant: TENANT, accessToken: 'a1', accessTokenExpiresAt: '' },
    restore: vi.fn(async () => null),
    me: vi.fn(async () => ({
      userId: ADMIN,
      tenantId: TENANT.id,
      cell: 'local',
      code: 'SUN-001',
      name: 'Anita Rao',
      designation: 'head',
      role: 'tenant_admin',
      scope: 'tenant',
      permissions,
      deviceId: null,
    })),
    signOut: vi.fn(async () => {}),
    switchTenant: vi.fn(),
    config: vi.fn(async () => ({
      status: 'fresh',
      etag: '"1-role"',
      bundle: {
        version: 1,
        settings: SETTING_DEFAULTS,
        terminology: {},
        designations: [],
        accountTypes: [],
        forms: [],
        catalogue: { units: [], measureTypes: [] },
        access: { role: 'tenant_admin', scope: 'tenant', permissions },
        ...bundle,
      },
    })),
  };
}

export type FakeClient = ReturnType<typeof fakeClient>;

export function renderAt(path: string, client: FakeClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ client: client as unknown as WebClient, queryClient });
  const memory = createRouter({
    ...router.options,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <RouterProvider router={memory} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return memory;
}

/** Every call that isn't a read. */
export const writesOf = (client: FakeClient) =>
  client.request.mock.calls.filter(([method]) => method !== 'GET');

/**
 * What the print dialog would see after `act` presses a Print button: the text of the one sheet
 * under the body (decision D99). The dialog is the `browser` seam, replaced for the moment.
 */
export async function printedText(act: () => Promise<void>): Promise<string> {
  const { browser } = await import('./browser');
  let seen = '';
  const print = vi.spyOn(browser, 'print').mockImplementation(() => {
    const sheets = document.querySelectorAll('body > .ks-print-sheet');
    expect(sheets).toHaveLength(1);
    seen = sheets[0]!.textContent ?? '';
  });
  try {
    await act();
    expect(print).toHaveBeenCalledOnce();
  } finally {
    print.mockRestore();
  }
  return seen;
}
