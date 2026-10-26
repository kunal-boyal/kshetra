import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, createClient, NetworkError, type SessionState } from './client';
import { memoryStore } from './stores';

const TENANT = {
  id: '01a10000-0000-7000-8000-000000000001',
  name: 'Sunrise Traders',
  cellUrl: 'https://cell.test',
};
const USER = '01a10000-0000-7000-8000-000000000002';

const later = (ms: number) => new Date(Date.now() + ms).toISOString();

function session(token: string, refresh?: string, ttl = 15 * 60_000) {
  return {
    tokenType: 'Bearer' as const,
    accessToken: token,
    accessTokenExpiresAt: later(ttl),
    ...(refresh ? { refreshToken: refresh } : {}),
    refreshTokenExpiresAt: later(30 * 86_400_000),
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const ME = {
  userId: USER,
  tenantId: TENANT.id,
  cell: 'local',
  code: 'SUN-001',
  name: 'Anita Rao',
  designation: 'head',
  role: 'tenant_admin',
  scope: 'tenant',
  permissions: ['user.view'],
  deviceId: null,
};

/** A fake API: it records every call and answers from the handler. */
function fakeServer(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe('signing in', () => {
  it('keeps the session from the code and calls the cell with its access token', async () => {
    const server = fakeServer((url) => {
      if (url.endsWith('/auth/v1/otp/verify')) {
        return json(200, { status: 'signed_in', tenant: TENANT, session: session('a1', 'r1') });
      }
      return json(200, ME);
    });
    const store = memoryStore();
    const client = createClient({ directoryUrl: '', platform: 'app', store, fetch: server.fetch });
    const result = await client.verifyCode('9000000001', '123456');
    expect(result.status).toBe('signed_in');
    expect(await store.load()).toMatchObject({ accessToken: 'a1', refreshToken: 'r1' });

    expect((await client.me()).name).toBe('Anita Rao');
    const call = server.calls[1]!;
    expect(call.url).toBe('https://cell.test/v1/me');
    expect((call.init.headers as Record<string, string>).authorization).toBe('Bearer a1');
    expect((call.init.headers as Record<string, string>)['x-device-time']).toMatch(/^\d{4}-/);
  });

  it('downloads a file from the cell with the token, and turns a refusal into an ApiError', async () => {
    const server = fakeServer((url) => {
      if (url.endsWith('/auth/v1/otp/verify')) {
        return json(200, { status: 'signed_in', tenant: TENANT, session: session('a1', 'r1') });
      }
      if (url.endsWith('/missing/pdf')) {
        return json(404, { error: { code: 'NOT_FOUND', message: 'No.', requestId: 'r' } });
      }
      return new Response('%PDF-1.3', { headers: { 'content-type': 'application/pdf' } });
    });
    const client = createClient({
      directoryUrl: '',
      platform: 'app',
      store: memoryStore(),
      fetch: server.fetch,
    });
    await client.verifyCode('9000000001', '123456');
    const file = await client.file('/v1/billing/invoices/one/pdf');
    expect(await file.text()).toBe('%PDF-1.3');
    expect(server.calls[1]!.url).toBe('https://cell.test/v1/billing/invoices/one/pdf');
    await expect(client.file('/v1/billing/invoices/missing/pdf')).rejects.toBeInstanceOf(ApiError);
  });

  it('on the web sends the client header and the cookie, and never holds a refresh token', async () => {
    const server = fakeServer(() =>
      json(200, { status: 'signed_in', tenant: TENANT, session: session('a1') }),
    );
    const store = memoryStore();
    const client = createClient({ directoryUrl: '', platform: 'web', store, fetch: server.fetch });
    await client.verifyCode('9000000001', '123456');
    const { init } = server.calls[0]!;
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['x-client']).toBe('web');
    expect((await store.load())?.refreshToken).toBeUndefined();
  });
});

describe('refreshing', () => {
  it('refreshes once for many calls when the server says the token expired', async () => {
    let refreshes = 0;
    const server = fakeServer(async (url, init) => {
      if (url.endsWith('/auth/v1/token/refresh')) {
        refreshes += 1;
        expect(JSON.parse(String(init.body))).toEqual({ refreshToken: 'r1' });
        return json(200, { session: session('a2', 'r2'), tenant: TENANT });
      }
      const auth = (init.headers as Record<string, string>).authorization;
      return auth === 'Bearer a2'
        ? json(200, ME)
        : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'Expired', requestId: 'x' } });
    });
    const store = memoryStore();
    await store.save({ tenant: TENANT, ...session('a1', 'r1') } as SessionState);
    const client = createClient({ directoryUrl: '', platform: 'app', store, fetch: server.fetch });
    const results = await Promise.all([client.me(), client.me(), client.me()]);
    expect(results.every((me) => me.userId === USER)).toBe(true);
    expect(refreshes).toBe(1);
    expect(await store.load()).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
  });

  it('follows a tenant moved to another cell: refreshes, then calls the new cell', async () => {
    const moved = { ...TENANT, cellUrl: 'https://cell-b.test' };
    const server = fakeServer((url) => {
      if (url.endsWith('/auth/v1/token/refresh')) {
        return json(200, { session: session('a2', 'r2'), tenant: moved });
      }
      return url.startsWith('https://cell-b.test')
        ? json(200, ME)
        : json(401, { error: { code: 'TENANT_MOVED', message: 'Moved', requestId: 'x' } });
    });
    const store = memoryStore();
    await store.save({ tenant: TENANT, ...session('a1', 'r1') } as SessionState);
    const client = createClient({ directoryUrl: '', platform: 'app', store, fetch: server.fetch });
    expect((await client.me()).userId).toBe(USER);
    expect(server.calls.map(({ url }) => url)).toEqual([
      'https://cell.test/v1/me',
      '/auth/v1/token/refresh',
      'https://cell-b.test/v1/me',
    ]);
    expect((await store.load())?.tenant.cellUrl).toBe('https://cell-b.test');
  });

  it('refreshes ahead of a token about to run out, inside the lock', async () => {
    const order: string[] = [];
    const server = fakeServer((url) => {
      order.push(new URL(url, 'https://web.test').pathname);
      return url.endsWith('/auth/v1/token/refresh')
        ? json(200, { session: session('a2'), tenant: TENANT })
        : json(200, ME);
    });
    const store = memoryStore();
    await store.save({ tenant: TENANT, ...session('a1', undefined, 10_000) } as SessionState);
    const locked: string[] = [];
    const lock = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
      locked.push(name);
      return work();
    };
    const client = createClient({
      directoryUrl: '',
      platform: 'web',
      store,
      fetch: server.fetch,
      lock,
    });
    await client.me();
    expect(order).toEqual(['/auth/v1/token/refresh', '/v1/me']);
    expect(locked).toEqual(['session-refresh']);
  });

  it('ends the session when the server revokes it', async () => {
    const onSignedOut = vi.fn();
    const server = fakeServer(() =>
      json(401, { error: { code: 'SESSION_REVOKED', message: 'Ended', requestId: 'x' } }),
    );
    const store = memoryStore();
    await store.save({ tenant: TENANT, ...session('a1', 'r1') } as SessionState);
    const client = createClient({
      directoryUrl: '',
      platform: 'app',
      store,
      fetch: server.fetch,
      onSignedOut,
    });
    await expect(client.me()).rejects.toMatchObject({ code: 'SESSION_REVOKED', status: 401 });
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(await store.load()).toBeNull();
  });

  it('restores a web session from the cookie, or finds none', async () => {
    let signedIn = true;
    const server = fakeServer(() =>
      signedIn
        ? json(200, { session: session('a9'), tenant: TENANT })
        : json(401, { error: { code: 'SESSION_REVOKED', message: 'No', requestId: 'x' } }),
    );
    const client = createClient({
      directoryUrl: 'https://auth.test',
      platform: 'web',
      store: memoryStore(),
      fetch: server.fetch,
    });
    expect(await client.restore()).toMatchObject({ accessToken: 'a9', tenant: TENANT });
    expect(server.calls[0]!.url).toBe('https://auth.test/auth/v1/token/refresh');
    signedIn = false;
    const fresh = createClient({
      directoryUrl: 'https://auth.test',
      platform: 'web',
      store: memoryStore(),
      fetch: server.fetch,
    });
    expect(await fresh.restore()).toBeNull();
  });
});

describe('signing out', () => {
  const offline = () => {
    throw new TypeError('Failed to fetch');
  };

  it('on a phone forgets the session even when the directory is out of reach', async () => {
    const onSignedOut = vi.fn();
    const store = memoryStore();
    await store.save({ tenant: TENANT, ...session('a1', 'r1') } as SessionState);
    const client = createClient({
      directoryUrl: '',
      platform: 'app',
      store,
      fetch: fakeServer(offline).fetch,
      onSignedOut,
    });
    await client.signOut();
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(await store.load()).toBeNull();
  });

  it('on the web stays signed in when the directory is out of reach, as its cookie does', async () => {
    const onSignedOut = vi.fn();
    const store = memoryStore();
    await store.save({ tenant: TENANT, ...session('a1') } as SessionState);
    const client = createClient({
      directoryUrl: '',
      platform: 'web',
      store,
      fetch: fakeServer(offline).fetch,
      onSignedOut,
    });
    await expect(client.signOut()).rejects.toBeInstanceOf(NetworkError);
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(client.session?.accessToken).toBe('a1');
  });
});

describe('errors', () => {
  it('carry the code, the details and how long to wait', async () => {
    const server = fakeServer(() =>
      json(
        429,
        { error: { code: 'RATE_LIMITED', message: 'Too many', requestId: 'x' } },
        { 'retry-after': '42' },
      ),
    );
    const client = createClient({
      directoryUrl: '',
      platform: 'app',
      store: memoryStore(),
      fetch: server.fetch,
    });
    const error = await client.requestCode('9000000001').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 42 });
  });

  it('tell a phone app when it must update, and it names its version on every call', async () => {
    const onUpgradeRequired = vi.fn();
    const server = fakeServer(() =>
      json(426, { error: { code: 'UPGRADE_REQUIRED', message: 'Update', requestId: 'x' } }),
    );
    const client = createClient({
      directoryUrl: '',
      platform: 'app',
      store: memoryStore(),
      fetch: server.fetch,
      app: { platform: 'android', version: '1.0.0' },
      onUpgradeRequired,
    });
    await expect(client.requestCode('9000000001')).rejects.toMatchObject({
      code: 'UPGRADE_REQUIRED',
    });
    expect(onUpgradeRequired).toHaveBeenCalledOnce();
    const headers = server.calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-app-platform']).toBe('android');
    expect(headers['x-app-version']).toBe('1.0.0');
  });

  it('answer an unchanged config bundle as not modified', async () => {
    const server = fakeServer(() => new Response(null, { status: 304 }));
    const store = memoryStore();
    await store.save({ tenant: TENANT, ...session('a1') } as SessionState);
    const client = createClient({ directoryUrl: '', platform: 'web', store, fetch: server.fetch });
    expect(await client.config('"7-role"')).toEqual({ status: 'not_modified' });
    expect((server.calls[0]!.init.headers as Record<string, string>)['if-none-match']).toBe(
      '"7-role"',
    );
  });
});

describe('files', () => {
  it('sends a file as the body itself, with its own type and an idempotency key', async () => {
    const server = fakeServer(() => json(201, { id: 'job' }));
    const store = memoryStore();
    await store.save({ tenant: TENANT, ...session('a1', 'r1') } as SessionState);
    const client = createClient({ directoryUrl: '', platform: 'app', store, fetch: server.fetch });
    const file = new Blob(['Code,Name\nA-1,Asha'], { type: 'text/csv' });
    await client.request('POST', '/v1/imports?target=users&fileName=a.csv', z.unknown(), {
      file: { data: file, type: 'text/csv' },
      idempotencyKey: 'k1',
    });
    const [call] = server.calls;
    expect(call!.url).toBe('https://cell.test/v1/imports?target=users&fileName=a.csv');
    expect(call!.init.body).toBe(file);
    expect(call!.init.headers).toMatchObject({
      'content-type': 'text/csv',
      'idempotency-key': 'k1',
    });
  });
});

describe('step-up (decision D101)', () => {
  const required = () =>
    json(403, {
      error: {
        code: 'SECOND_FACTOR_REQUIRED',
        message: 'Enter a code from your authenticator to make this change.',
        requestId: 'r',
      },
    });

  it('asks for a fresh code, steps up, and sends the change again with the new token', async () => {
    const server = fakeServer((url, init) => {
      const auth = (init.headers as Record<string, string>).authorization;
      if (url.endsWith('/auth/v1/authenticator/step-up')) {
        const { code } = JSON.parse(String(init.body)) as { code: string };
        return code === '111111'
          ? json(200, { accessToken: 'stepped', accessTokenExpiresAt: later(15 * 60_000) })
          : json(400, { error: { code: 'OTP_INVALID', message: 'Wrong.', requestId: 'r' } });
      }
      return auth === 'Bearer stepped' ? json(200, { ok: true }) : required();
    });
    const store = memoryStore();
    await store.save({ tenant: TENANT, ...session('a1', 'r1') } as SessionState);
    const asked: (string | null)[] = [];
    const client = createClient({
      directoryUrl: '',
      platform: 'app',
      store,
      fetch: server.fetch,
      stepUp: async (wrong) => {
        asked.push(wrong?.code ?? null);
        return asked.length === 1 ? '000000' : '111111';
      },
    });
    const answer = await client.request('PATCH', '/v1/users/x', z.object({ ok: z.boolean() }), {
      body: { phone: '+919876543210' },
    });
    expect(answer).toEqual({ ok: true });
    // The wrong code was said so, and the second try went through.
    expect(asked).toEqual([null, 'OTP_INVALID']);
    expect(client.session?.accessToken).toBe('stepped');
  });

  it('fails the change as it was when the person declines', async () => {
    const server = fakeServer(() => required());
    const store = memoryStore();
    await store.save({ tenant: TENANT, ...session('a1', 'r1') } as SessionState);
    const client = createClient({
      directoryUrl: '',
      platform: 'app',
      store,
      fetch: server.fetch,
      stepUp: async () => null,
    });
    await expect(
      client.request('PATCH', '/v1/users/x', z.object({ ok: z.boolean() }), { body: {} }),
    ).rejects.toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' });
    expect(server.calls.filter((call) => call.url.endsWith('/step-up'))).toHaveLength(0);
  });
});
