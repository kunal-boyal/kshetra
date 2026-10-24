import { createConsoleClient } from '@thelamp/api-client';

/**
 * The console's API client (decision D88). The refresh token lives in an httpOnly cookie and the
 * access token only in memory, so a reload restores the session from the cookie (spec 13.1).
 * Refreshes take turns across tabs, so two tabs never spend the same cookie.
 */
export function consoleClient(onSignedOut: () => void) {
  return createConsoleClient({
    baseUrl: import.meta.env.VITE_PLATFORM_URL ?? '',
    lock: (name, work) =>
      typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(name, work)
        : work(),
    onSignedOut,
  });
}

export type ConsoleClient = ReturnType<typeof consoleClient>;
