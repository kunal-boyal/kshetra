import {
  APP_PLATFORM_HEADER,
  APP_VERSION_HEADER,
  type AppPlatform,
  ConfigBundle,
  type DeviceHeartbeatBody,
  type DeviceInfo,
  type ErrorCode,
  type ErrorDetail,
  isErrorCode,
  MeResult,
  OtpRequestResult,
  OtpVerifyResult,
  RefreshResult,
  type Session,
  SignedIn,
  type SyncEntity,
  SyncPullResult,
  type TenantSummary,
  WEB_CLIENT,
  WEB_CLIENT_HEADER,
} from '@kshetra/shared';
import type { z } from 'zod';

/** An error response from the API (spec 11.1), with its code from spec 11.4. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: readonly ErrorDetail[] = [],
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API could not be reached at all: no network, or the server is down. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The server could not be reached.', { cause });
    this.name = 'NetworkError';
  }
}

/** What a signed-in client holds. The web's refresh token is never here: it lives in a cookie. */
export interface SessionState {
  tenant: TenantSummary;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken?: string;
}

/** Where the session is kept between launches: the phone's secure store, or memory on the web. */
export interface SessionStore {
  load(): Promise<SessionState | null>;
  save(session: SessionState | null): Promise<void>;
}

export interface ClientOptions {
  /** The directory's base URL; empty for the page's own origin. */
  directoryUrl: string;
  /**
   * `web` leaves the refresh token in the directory's httpOnly cookie (spec 13.1); `app` keeps it
   * in the session store.
   */
  platform: 'web' | 'app';
  store: SessionStore;
  /**
   * Runs refreshes one at a time across tabs or processes, such as `navigator.locks.request` on
   * the web. Two refreshes with the same token would end the whole session (M1, rule 6).
   */
  lock?: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  /** The base URL for a tenant's cell; by default the one the directory hands out at sign-in. */
  cellUrl?: (tenant: TenantSummary) => string;
  /** The phone signing in, sent by the mobile app so the tenant can bind it (M1, rule 5). */
  device?: () => Promise<DeviceInfo | undefined>;
  /**
   * The mobile app's platform and store version, sent with every request so the API can turn
   * away versions it no longer supports (M1, rule 8). The web sends neither.
   */
  app?: { platform: AppPlatform; version: string };
  /** Called when the API answers `UPGRADE_REQUIRED`: the app shows its blocking update screen. */
  onUpgradeRequired?: () => void;
  fetch?: typeof fetch;
  /** Called when the session ends: signed out, revoked, or no longer refreshable. */
  onSignedOut?: () => void;
}

export interface RequestOptions {
  body?: unknown;
  /** A file sent as the body itself, such as an import (M19), in place of a JSON `body`. */
  file?: { data: Blob; type: string };
  /** For creates and actions without a client-generated ID (spec 11.1, BR-46). */
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

/** Refresh a little before the access token runs out, so requests never race its expiry. */
const EXPIRY_MARGIN_MS = 30_000;

function toState(tenant: TenantSummary, session: Session, previous?: SessionState): SessionState {
  const refreshToken = session.refreshToken ?? previous?.refreshToken;
  return {
    tenant,
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    ...(refreshToken ? { refreshToken } : {}),
  };
}

/**
 * `tenant:user` as the access token names them. The signature isn't checked: only the server can,
 * and this only decides whose data the phone shows and whose uploads it sends.
 */
export function ownerOf(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    // The claims are ASCII, so the decoded bytes are the JSON's characters.
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as {
      sub?: unknown;
      tid?: unknown;
    };
    return typeof claims.sub === 'string' && typeof claims.tid === 'string'
      ? `${claims.tid}:${claims.sub}`
      : null;
  } catch {
    return null;
  }
}

async function errorFrom(response: Response): Promise<ApiError> {
  const retryAfter = response.headers.get('retry-after');
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: ErrorDetail[] };
    };
    const code = body.error?.code ?? '';
    return new ApiError(
      response.status,
      isErrorCode(code) ? code : 'INTERNAL',
      body.error?.message ?? response.statusText,
      body.error?.details ?? [],
      retryAfter ? Number(retryAfter) : undefined,
    );
  } catch {
    return new ApiError(response.status, 'INTERNAL', response.statusText);
  }
}

/**
 * The client for the directory's sign-in and the tenant's cell (spec 11). It keeps the session,
 * sends the access token, refreshes it before it expires or when the server says so, and ends the
 * session when the server revokes it.
 */
export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const lock = options.lock ?? (async <T>(_name: string, work: () => Promise<T>) => work());
  const web = options.platform === 'web';
  const appHeaders: Record<string, string> = options.app
    ? { [APP_PLATFORM_HEADER]: options.app.platform, [APP_VERSION_HEADER]: options.app.version }
    : {};
  let session: SessionState | null = null;
  let loaded = false;
  let refreshing: Promise<SessionState> | null = null;

  async function current(): Promise<SessionState | null> {
    if (!loaded) {
      session = await options.store.load();
      loaded = true;
    }
    return session;
  }

  async function keep(next: SessionState | null): Promise<void> {
    session = next;
    loaded = true;
    await options.store.save(next);
  }

  async function signedOut(): Promise<void> {
    await keep(null);
    options.onSignedOut?.();
  }

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, init);
    } catch (error) {
      throw new NetworkError(error);
    }
  }

  /** The error a failed response carries, after telling the app when it must update. */
  async function failure(response: Response): Promise<ApiError> {
    const error = await errorFrom(response);
    if (error.code === 'UPGRADE_REQUIRED') options.onUpgradeRequired?.();
    return error;
  }

  /** A call to the directory's sign-in routes. The web sends its client header and cookie. */
  async function directory<T extends z.ZodType>(
    path: string,
    schema: T,
    body: unknown,
  ): Promise<z.output<T>> {
    const response = await send(`${options.directoryUrl}/auth/v1/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(web ? { [WEB_CLIENT_HEADER]: WEB_CLIENT } : {}),
        ...appHeaders,
      },
      body: JSON.stringify(body ?? {}),
      credentials: web ? 'include' : 'omit',
    });
    if (!response.ok) throw await failure(response);
    return schema.parse(await response.json());
  }

  async function refresh(): Promise<SessionState> {
    refreshing ??= lock('session-refresh', async () => {
      const before = await current();
      if (!web && !before?.refreshToken) throw new ApiError(401, 'SESSION_REVOKED', 'Sign in.');
      try {
        const result = await directory(
          'token/refresh',
          RefreshResult,
          web ? {} : { refreshToken: before!.refreshToken },
        );
        const next = toState(result.tenant, result.session, before ?? undefined);
        await keep(next);
        return next;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) await signedOut();
        throw error;
      }
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function expiring(state: SessionState): boolean {
    return Date.parse(state.accessTokenExpiresAt) - Date.now() < EXPIRY_MARGIN_MS;
  }

  function cellBase(tenant: TenantSummary): string {
    return options.cellUrl ? options.cellUrl(tenant) : tenant.cellUrl;
  }

  async function signedIn(result: z.output<typeof SignedIn>): Promise<SessionState> {
    const state = toState(result.tenant, result.session);
    await keep(state);
    return state;
  }

  /**
   * A call to the tenant's cell, with the access token. A token that is about to expire, or that
   * the server calls expired, is refreshed once and the call repeated.
   */
  async function cell(method: string, path: string, request: RequestOptions = {}) {
    const attempt = async (state: SessionState) =>
      send(`${cellBase(state.tenant)}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${state.accessToken}`,
          'x-device-time': new Date().toISOString(),
          ...appHeaders,
          ...(request.file
            ? { 'content-type': request.file.type }
            : request.body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          ...(request.idempotencyKey ? { 'idempotency-key': request.idempotencyKey } : {}),
          ...request.headers,
        },
        ...(request.file
          ? { body: request.file.data }
          : request.body === undefined
            ? {}
            : { body: JSON.stringify(request.body) }),
      });
    let state = await current();
    if (!state) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    if (expiring(state)) state = await refresh();
    let response = await attempt(state);
    if (response.status === 401) {
      const error = await failure(response);
      if (error.code !== 'TOKEN_EXPIRED') {
        if (error.code === 'SESSION_REVOKED') await signedOut();
        throw error;
      }
      response = await attempt(await refresh());
    }
    // A 304 answers a conditional request for something the caller already has.
    if (!response.ok && response.status !== 304) {
      const error = await failure(response);
      if (error.code === 'SESSION_REVOKED') await signedOut();
      throw error;
    }
    return response;
  }

  return {
    /** The session, once loaded or signed in. */
    get session(): SessionState | null {
      return session;
    },

    requestCode(phone: string) {
      return directory('otp/request', OtpRequestResult, { phone });
    },

    /** Verifies a code. One tenant signs straight in; several return a ticket to choose with. */
    async verifyCode(phone: string, code: string) {
      const device = await options.device?.();
      const result = await directory('otp/verify', OtpVerifyResult, {
        phone,
        code,
        ...(device ? { device } : {}),
      });
      if (result.status === 'signed_in') await signedIn(result);
      return result;
    },

    async selectTenant(ticket: string, tenantId: string) {
      const device = await options.device?.();
      return signedIn(
        await directory('select-tenant', SignedIn, {
          ticket,
          tenantId,
          ...(device ? { device } : {}),
        }),
      );
    },

    async switchTenant(tenantId: string) {
      const before = await current();
      const device = await options.device?.();
      return signedIn(
        await directory('switch-tenant', SignedIn, {
          tenantId,
          ...(web ? {} : { refreshToken: before?.refreshToken }),
          ...(device ? { device } : {}),
        }),
      );
    },

    /**
     * Picks up an earlier session: the stored one on a phone, or on the web a fresh access token
     * from the cookie, which is the only way to learn whether a session exists. Resolves to null
     * when there is none.
     */
    async restore(): Promise<SessionState | null> {
      const state = await current();
      if (!web && !state) return null;
      try {
        return web || (state && expiring(state)) ? await refresh() : state;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },

    /**
     * Ends the session. A phone forgets it even when the directory can't be reached. The web
     * can't: only the directory can clear its httpOnly cookie, so the web stays signed in and
     * the call rejects, rather than looking signed out until the next reload signs back in.
     */
    async signOut(): Promise<void> {
      const state = await current();
      try {
        await send(`${options.directoryUrl}/auth/v1/logout`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(web ? { [WEB_CLIENT_HEADER]: WEB_CLIENT } : {}),
            ...appHeaders,
          },
          body: JSON.stringify(web ? {} : { refreshToken: state?.refreshToken }),
          credentials: web ? 'include' : 'omit',
        });
      } catch (error) {
        if (web) throw error;
      }
      await signedOut();
    },

    async me() {
      return MeResult.parse(await (await cell('GET', '/v1/me')).json());
    },

    /**
     * The config bundle (spec 11.2). With the ETag of the copy the caller has, an unchanged bundle
     * answers `not_modified` instead of the whole bundle again.
     */
    async config(etag?: string) {
      const response = await cell('GET', '/v1/config', {
        ...(etag ? { headers: { 'if-none-match': etag } } : {}),
      });
      if (response.status === 304) return { status: 'not_modified' as const };
      return {
        status: 'fresh' as const,
        etag: response.headers.get('etag') ?? undefined,
        bundle: ConfigBundle.parse(await response.json()),
      };
    },

    /** `tenant:user` of whoever is signed in, or null; see `ownerOf`. */
    get owner(): string | null {
      return session ? ownerOf(session.accessToken) : null;
    },

    /** The next page of the reference data the phone keeps (spec 11.3). */
    async syncPull(entities: readonly SyncEntity[], cursor?: string) {
      const query = new URLSearchParams({ entities: entities.join(',') });
      if (cursor) query.set('cursor', cursor);
      return SyncPullResult.parse(await (await cell('GET', `/v1/sync/pull?${query}`)).json());
    },

    /** The phone's health: permissions, battery optimisation and its upload queue (M3). */
    async heartbeat(body: DeviceHeartbeatBody): Promise<void> {
      await cell('POST', '/v1/devices/heartbeat', { body });
    },

    /** Any other call to the cell, for the screens that arrive with each module. */
    async request<T extends z.ZodType>(
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      path: string,
      schema: T,
      request: RequestOptions = {},
    ): Promise<z.output<T> | undefined> {
      const response = await cell(method, path, request);
      if (response.status === 204) return undefined;
      return schema.parse(await response.json());
    },
  };
}

export type Client = ReturnType<typeof createClient>;
