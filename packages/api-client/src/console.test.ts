import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from './client';
import { createConsoleClient } from './console';

const STAFF = {
  id: '01a10000-0000-7000-8000-0000000000aa',
  email: 'meera@vendor.example',
  name: 'Meera Iyer',
  role: 'platform_admin',
  status: 'active',
  permissions: ['platform.tenant.manage'],
  lastSignInAt: null,
  createdAt: '2026-10-24T10:00:00.000Z',
};
const session = (token: string, minutes = 15) => ({
  accessToken: token,
  accessTokenExpiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
  staff: STAFF,
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** A fake fetch, as the client takes one. */
const asFetch = (fake: unknown) => fake as typeof globalThis.fetch;
const failure = (status: number, code: string) =>
  json(status, { error: { code, message: code, requestId: 'r' } });

describe('the console client (decision D88)', () => {
  it('signs in, sends the token, and marks every request as the console’s', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
      url.endsWith('/platform/v1/session') ? json(200, session('one')) : json(200, { ok: true }),
    );
    const client = createConsoleClient({ baseUrl: 'https://api.example', fetch: asFetch(fetch) });
    expect(await client.signIn(STAFF.email, 'a long password', '123456')).toMatchObject({
      email: STAFF.email,
    });
    await client.request('GET', '/platform/v1/tenants', z.object({ ok: z.boolean() }));
    const [, init] = fetch.mock.calls[1]!;
    expect(init?.credentials).toBe('include');
    expect(init?.headers).toMatchObject({ 'x-client': 'console', authorization: 'Bearer one' });
  });

  it('refreshes from the cookie when the server says the token expired', async () => {
    let calls = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/session/refresh')) return json(200, session('two'));
      if (url.endsWith('/platform/v1/session')) return json(200, session('one'));
      calls++;
      const auth = (init?.headers as Record<string, string>).authorization;
      return auth === 'Bearer one' ? failure(401, 'TOKEN_EXPIRED') : json(200, { ok: true });
    });
    const client = createConsoleClient({ baseUrl: '', fetch: asFetch(fetch) });
    await client.signIn(STAFF.email, 'a long password', '123456');
    expect(await client.request('GET', '/platform/v1/me', z.object({ ok: z.boolean() }))).toEqual({
      ok: true,
    });
    expect(calls).toBe(2);
  });

  it('signs out when the cookie no longer works, or the server revokes the session', async () => {
    const onSignedOut = vi.fn();
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/session/refresh') ? failure(401, 'SESSION_REVOKED') : json(200, {}),
    );
    const client = createConsoleClient({ baseUrl: '', fetch: asFetch(fetch), onSignedOut });
    expect(await client.restore()).toBeNull();
    await expect(client.request('GET', '/platform/v1/me', z.object({}))).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(onSignedOut).toHaveBeenCalled();
    expect(client.staff).toBeNull();
  });
});
