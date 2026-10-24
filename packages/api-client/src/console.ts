import {
  CONSOLE_CLIENT,
  StaffResult,
  StaffSession,
  StaffSetupResult,
  WEB_CLIENT_HEADER,
} from '@thelamp/shared';
import type { z } from 'zod';
import { ApiError, errorFrom, NetworkError } from './client';

export interface ConsoleClientOptions {
  /** Where `/platform/v1` is; empty for the page's own origin. */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Runs refreshes one at a time across tabs, as `navigator.locks.request` does. */
  lock?: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  /** Called when the session ends: signed out, revoked, or no longer refreshable. */
  onSignedOut?: () => void;
}

/** Refresh a little before the access token runs out. */
const EXPIRY_MARGIN_MS = 30_000;

/**
 * The platform console's client (module M22, decision D88). Vendor staff's refresh token lives in
 * an httpOnly cookie the console never sees; the access token lives here, in memory, and is
 * refreshed before it runs out or when the server says it has. A revoked session signs out.
 */
export function createConsoleClient(options: ConsoleClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const lock = options.lock ?? (async <T>(_name: string, work: () => Promise<T>) => work());
  let session: z.infer<typeof StaffSession> | null = null;
  let refreshing: Promise<z.infer<typeof StaffSession> | null> | null = null;

  async function send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(`${options.baseUrl}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          [WEB_CLIENT_HEADER]: CONSOLE_CLIENT,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch (error) {
      throw new NetworkError(error);
    }
  }

  async function read<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    if (!response.ok) throw await errorFrom(response);
    return schema.parse(await response.json());
  }

  function signedOut(): void {
    session = null;
    options.onSignedOut?.();
  }

  /** A new access token from the cookie, one refresh at a time; null when the session is over. */
  function refresh(): Promise<z.infer<typeof StaffSession> | null> {
    refreshing ??= lock('console-refresh', async () => {
      const response = await send('/platform/v1/session/refresh', { method: 'POST' });
      if (response.status === 401) return null;
      return read(response, StaffSession);
    }).finally(() => {
      refreshing = null;
    });
    return refreshing.then((next) => {
      session = next;
      return next;
    });
  }

  async function token(): Promise<string> {
    if (!session || Date.parse(session.accessTokenExpiresAt) - Date.now() < EXPIRY_MARGIN_MS) {
      const next = await refresh();
      if (!next) {
        signedOut();
        throw new ApiError(401, 'SESSION_REVOKED', 'Sign in again.');
      }
    }
    return session!.accessToken;
  }

  return {
    get staff(): z.infer<typeof StaffResult> | null {
      return session?.staff ?? null;
    },

    /** After a reload: the cookie's session, if it is still good. */
    async restore(): Promise<z.infer<typeof StaffResult> | null> {
      return (await refresh())?.staff ?? null;
    },

    async signIn(email: string, password: string, code: string) {
      const response = await send('/platform/v1/session', {
        method: 'POST',
        body: JSON.stringify({ email, password, code }),
      });
      session = await read(response, StaffSession);
      return session.staff;
    },

    async signOut(): Promise<void> {
      await send('/platform/v1/session/logout', { method: 'POST' }).catch(() => undefined);
      signedOut();
    },

    /** Setting up from an invitation: the password first, then a code from the authenticator. */
    async setUp(setupToken: string, password: string) {
      const response = await send('/platform/v1/setup', {
        method: 'POST',
        body: JSON.stringify({ token: setupToken, password }),
      });
      return read(response, StaffSetupResult);
    },

    async confirm(setupToken: string, code: string) {
      const response = await send('/platform/v1/setup/confirm', {
        method: 'POST',
        body: JSON.stringify({ token: setupToken, code }),
      });
      return read(response, StaffResult);
    },

    /**
     * A console request with the staff member's token. A token the server calls expired is
     * refreshed once and the request sent again; a revoked session signs out.
     */
    async request<T>(
      method: 'GET' | 'POST',
      path: string,
      schema: z.ZodType<T>,
      body?: unknown,
    ): Promise<T> {
      const attempt = async (accessToken: string) =>
        send(path, {
          method,
          headers: { authorization: `Bearer ${accessToken}` },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      let response = await attempt(await token());
      if (response.status === 401) {
        const error = await errorFrom(response.clone());
        if (error.code === 'TOKEN_EXPIRED') {
          session = null;
          response = await attempt(await token());
        } else if (error.code === 'SESSION_REVOKED') {
          signedOut();
        }
      }
      return read(response, schema);
    },
  };
}

export type ConsoleClient = ReturnType<typeof createConsoleClient>;
