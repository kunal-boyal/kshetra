// What the load scripts share (spec 14.4, decision D68): the API's address, the sessions the
// fixture generator wrote, and a session per virtual user that refreshes itself.
import { check, fail } from 'k6';
import http from 'k6/http';
import { SharedArray } from 'k6/data';

export const API = __ENV.API_URL || 'http://127.0.0.1:3000';
const FIXTURES = __ENV.FIXTURES || './.fixtures/local.json';

const file = () => JSON.parse(open(FIXTURES));
export const fieldUsers = new SharedArray('field users', () => file().fieldUsers);
export const manager = new SharedArray('manager', () => [file().manager])[0];
export const period = new SharedArray('period', () => [file().period])[0];

/** Spends a refresh token for a new pair, as the app does (spec 13.1). */
export function refresh(refreshToken) {
  const response = http.post(`${API}/auth/v1/token/refresh`, JSON.stringify({ refreshToken }), {
    headers: { 'content-type': 'application/json' },
    tags: { name: 'refresh' },
  });
  if (!check(response, { refreshed: (r) => r.status === 200 })) {
    fail(`A refresh failed: ${response.status} ${response.body}`);
  }
  return response.json('session');
}

// A refresh token works once, so each virtual user keeps its own person, and refreshes their
// access token (15 minutes) after 10.
let session;
let issuedAt = 0;

export function fieldSession() {
  if (!session) {
    const user = fieldUsers[__VU - 1];
    if (!user) fail(`Virtual user ${__VU} has no load user: make more with --users.`);
    session = { refreshToken: user.refreshToken };
  }
  if (!session.accessToken || Date.now() - issuedAt > 10 * 60_000) {
    session = refresh(session.refreshToken);
    issuedAt = Date.now();
  }
  return session;
}

/**
 * The manager's access token, for scripts whose virtual users share it: spent once in setup, as a
 * refresh token works once. It lasts 15 minutes, so keep those runs shorter.
 */
export function managerToken() {
  return refresh(manager.refreshToken).accessToken;
}

/** Request parameters with the caller's token, a fresh idempotency key and a name for the metrics. */
export function as(token, name) {
  return {
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    tags: { name },
  };
}

export const uuid = () => crypto.randomUUID();

/** A place in Delhi, a few hundred metres from the last. */
export function nearDelhi() {
  return { lat: 28.6315 + (Math.random() - 0.5) / 200, lng: 77.2167 + (Math.random() - 0.5) / 200 };
}

// The open shift of this virtual user's person: punched in once, or found if already open.
let shiftId;

export function onShift(token) {
  if (shiftId) return shiftId;
  const id = uuid();
  const punched = http.post(
    `${API}/v1/shifts`,
    JSON.stringify({
      id,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      location: nearDelhi(),
      accuracy: 15,
      mocked: false,
      consentVersion: '2026-10',
    }),
    as(token, 'punch in'),
  );
  if (punched.status === 201) {
    shiftId = id;
  } else {
    const current = http.get(`${API}/v1/shifts/current`, as(token, 'current shift'));
    shiftId = current.json('id') || current.json('shift.id');
  }
  if (!shiftId) fail(`No shift for virtual user ${__VU}: ${punched.status} ${punched.body}`);
  return shiftId;
}
