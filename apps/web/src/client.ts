import { createClient, memoryStore } from '@thelamp/api-client';
import { askForStepUp } from './step-up';

/**
 * Where the portal reaches the cell: its own origin, which passes `/v1` and `/auth` to the cell
 * (Vite locally, CloudFront in AWS, Caddy in the demo), so the portal's Content-Security-Policy
 * and cookies stay same-origin. The address handed out at sign-in is for others to call.
 */
function cellUrl(): string {
  return import.meta.env.VITE_CELL_URL ?? '';
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
  const cell = cellUrl() || tenant?.cellUrl || here;
  return {
    tokenUrl: `${directory}/auth/v1/oauth/token`,
    apiUrl: `${cell}/v1`,
    docsUrl: `${cell}/v1/docs`,
  };
}
