import { createClient, memoryStore } from '@kshetra/api-client';

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
    // Locally the cell is proxied through this page's own origin.
    cellUrl: (tenant) =>
      import.meta.env.VITE_CELL_URL ?? (import.meta.env.DEV ? '' : tenant.cellUrl),
    onSignedOut,
  });
}

export type WebClient = ReturnType<typeof webClient>;
