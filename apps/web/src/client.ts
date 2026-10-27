import { createClient, memoryStore } from '@thelamp/api-client';
import type { TenantSummary } from '@thelamp/shared';
import { askForStepUp } from './step-up';

/** Where the cell answers; locally it is proxied through this page's own origin. */
function cellUrl(tenant: TenantSummary): string {
  return import.meta.env.VITE_CELL_URL ?? (import.meta.env.DEV ? '' : tenant.cellUrl);
}

/**
 * The API client for this page. On the web the refresh token lives in the directory's cookie and
 * the access token only in memory, so a reload restores the session from the cookie (spec 13.1).
 * Refreshes take turns across tabs, so two tabs never spend the same refresh token.
 */
export function webClient(onSignedOut: () => void) {
  return createClient({
    directoryUrl: import.meta.env.VITE_DIRECTORY_URL ?? '',
    platform: 'web',
    store: memoryStore(),
    lock: (name, work) =>
      typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(name, work)
        : work(),
    cellUrl,
    onSignedOut,
    stepUp: askForStepUp,
  });
}

export type WebClient = ReturnType<typeof webClient>;

/**
 * Where an organisation's own systems reach the API (decision D94): tokens from the directory,
 * everything else from the organisation's cell, as absolute addresses to copy.
 */
export function apiAddresses(client: Pick<WebClient, 'session'>) {
  const here = typeof window === 'undefined' ? '' : window.location.origin;
  const tenant = client.session?.tenant;
  const directory = import.meta.env.VITE_DIRECTORY_URL || here;
  const cell = (tenant ? cellUrl(tenant) : '') || here;
  return {
    tokenUrl: `${directory}/auth/v1/oauth/token`,
    apiUrl: `${cell}/v1`,
    docsUrl: `${cell}/v1/docs`,
  };
}
