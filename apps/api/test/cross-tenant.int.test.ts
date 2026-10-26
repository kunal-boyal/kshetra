import { createHash } from 'node:crypto';
import { type DeviceInfo, newId, todayIn } from '@thelamp/shared';
import { ModulesContainer } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { apiControllers } from '../src/app.module';
import { plans, subscriptions } from '../src/db/schema/directory';
import { BillingSettings } from '../src/modules/billing/billing-settings.service';
import { ExamplePlans } from '../src/modules/billing/example-plans';
import { InvoicesService } from '../src/modules/billing/invoices.service';
import { TenantBillingService } from '../src/modules/billing/tenant-billing.service';
import { StaffService } from '../src/modules/console/staff.service';
import { DirectoryDatabase } from '../src/modules/directory/directory.database';
import { SupportService } from '../src/modules/directory/support.service';
import { AnnouncementsService } from '../src/modules/directory/announcements.service';
import { NotificationDelivery } from '../src/modules/notifications/delivery';
import { type MemoryObjectStore, ObjectStore } from '../src/platform/object-store';
import { routeRegistry } from '../src/platform/routes';
import { newDevice, newPhone, startApp, World } from './support';

/**
 * The cross-tenant contract test (spec 14.4), over every route in the registry. Someone signed in
 * to tenant B who uses tenant A's IDs gets the answer an ID that exists nowhere gets, never a
 * success; what B reads holds nothing of A's; and after each of B's requests, every row tenant A
 * owns, in every table that has a `tenant_id`, is exactly as it was. A route without a fixture
 * here fails the test, so a new route can't ship without its case.
 */

const routes = routeRegistry(apiControllers());

let app: NestFastifyApplication;
let world: World;

type Reply = Awaited<ReturnType<NestFastifyApplication['inject']>>;
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Person {
  id: string;
  phone: string;
}

interface Tenant {
  tenantId: string;
  admin: Person;
  member: Person;
  /** The phone the member is bound to. */
  memberDevice: DeviceInfo;
  roleId: string;
  designationId: string;
  /** The tenant's own word for `term.account`, which no other tenant uses. */
  word: string;
}

let a: Tenant;
let b: Tenant;
let bToken: string;
/** A cursor tenant A's admin was given by a sync pull. */
let aCursor: string;
/** A transfer of A's member, scheduled for next month. */
let aTransferId: string;
/** A territory of A's, and an import A started. */
let aTerritoryId: string;
let aImportId: string;
/** A's account type, an account of it with a contact, and an approval waiting on A's admin. */
let aTypeId: string;
let aAccountId: string;
let aContactId: string;
let aApprovalId: string;
/** One of A's forms. */
let aFormId: string;
/** A photo A's admin uploaded. */
let aPhotoId: string;
/** A shift of A's member, with a point and a pause. */
let aShiftId: string;
let aPauseId: string;
/** A visit of A's member at A's account, and a submission made in it. */
let aVisitId: string;
let aSubmissionId: string;
/** A route and a plan item of A's member. */
let aRouteId: string;
let aPlanItemId: string;
let aExportId: string;
let aSupportGrantId: string;
let aApiClient: { id: string; clientId: string; secret: string };
/** A webhook of A's and the test message it sent. */
let aWebhookId: string;
let aWebhookMessageId: string;
/** A data export of A's, still waiting, as no worker runs here. */
let aDataExportId: string;
/** A personal data request of A's, logged for its member. */
let aDataRequestId: string;
let aInvoiceId: string;
let aItemId: string;
let aPriceListId: string;
let aRegularisationId: string;
let aLeaveRequestId: string;
let aClaimId: string;
/** A second claim of A's, whose ID B never uses for its own. */
let aOtherClaimId: string;
let aOrderId: string;
/** B's member, signed in on their bound phone. */
let bPhoneToken: string;
/** An account of B's own, under B's territory. */
let bAccountId: string;
let bTerritoryId: string;
/** A month for targets and account plans. */
const TARGET_MONTH = '2030-01';
/** A day comfortably in the future on every tenant's calendar. */
/** A webhook address nothing listens at, so tests send nowhere. */
const NOWHERE_HOOK = 'http://127.0.0.1:9/hooks';
const NEXT_MONTH = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
/** The day before today on the tenants' clock: a day gone, to hold a holiday or be fixed. */
const YESTERDAY = () =>
  new Date(Date.parse(`${todayIn('Asia/Kolkata')}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
/** A weekday next month, for leave. */
const LEAVE_DAY = (() => {
  let at = Date.parse(`${NEXT_MONTH}T00:00:00Z`);
  while ([0, 6].includes(new Date(at).getUTCDay())) at += 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
})();
/** Every ID in tenant A's rows that tenant B doesn't also hold. */
let aIds: string[];
let aRows: Record<string, unknown[]>;

async function admin<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: inject('databaseUrls').admin });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** Every row a tenant owns, in every table with a `tenant_id`, in the cell and the directory. */
async function rowsOf(tenantId: string): Promise<Record<string, unknown[]>> {
  const tables = await admin<{ schema: string; name: string }>(
    `select n.nspname as schema, c.relname as name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where n.nspname in ('cell', 'directory') and c.relkind in ('r', 'p') and not c.relispartition
      order by 1, 2`,
  );
  const rows: Record<string, unknown[]> = {};
  for (const { schema, name } of tables) {
    const [found] = await admin<{ rows: unknown[] }>(
      `select coalesce(json_agg(t order by t::text), '[]') as rows
         from "${schema}"."${name}" t where tenant_id = $1`,
      [tenantId],
    );
    rows[`${schema}.${name}`] = found!.rows;
  }
  return rows;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const idsIn = (value: unknown) => new Set(JSON.stringify(value).match(UUID) ?? []);

function send(token: string | undefined, method: Method, url: string, payload?: object) {
  return app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // Every write takes one (BR-46); reads ignore it.
      'idempotency-key': newId(),
    },
    ...(payload ? { payload } : {}),
  });
}

const asB = (method: Method, url: string, payload?: object) => send(bToken, method, url, payload);
const asBPhone = (method: Method, url: string, payload?: object) =>
  send(bPhoneToken, method, url, payload);

/** A real fix, as a punch carries it. */
const FIX = { location: { lat: 12.9716, lng: 77.5946 }, accuracy: 15, mocked: false };

/** B's member on shift, so what B sends from the phone is judged past the shift (BR-32). */
async function bOnShift() {
  if ((await asBPhone('GET', '/v1/shifts/current')).json().shift) return;
  const started = await asBPhone('POST', '/v1/shifts', {
    ...FIX,
    id: newId(),
    startedAt: new Date().toISOString(),
    consentVersion: '1',
  });
  expect(started.statusCode).toBe(201);
}

/** An import file, sent as the request body itself (M19). */
function upload(token: string, target: string, body: string) {
  return app.inject({
    method: 'POST',
    url: `/v1/imports?target=${target}&fileName=people.csv`,
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': newId(),
      'content-type': 'text/csv',
    },
    payload: body,
  });
}

const errorOf = (reply: Reply) => {
  const { error } = reply.json() as { error?: { requestId?: string } };
  return error ? { ...error, requestId: undefined } : undefined;
};

/** B's answer for A's ID is the answer for an ID that exists nowhere: a refusal that says nothing. */
async function sameAsNowhere(call: (id: string) => Promise<Reply>, theirId: string) {
  const theirs = await call(theirId);
  const nowhere = await call(newId());
  expect([400, 403, 404]).toContain(theirs.statusCode);
  expect(theirs.statusCode).toBe(nowhere.statusCode);
  expect(errorOf(theirs)).toEqual(errorOf(nowhere));
}

/** What B reads holds no ID of A's, and none of A's own words. */
function holdsNothingOfA(reply: Reply) {
  for (const id of aIds) expect(reply.body, `B's answer names A's ${id}`).not.toContain(id);
  expect(reply.body).not.toContain(a.word);
}

const named = (en: string) => ({ en, hi: en });
const noun = (word: string) => ({
  en: { one: word, other: `${word}s` },
  hi: { one: word, other: word },
});

/** A tenant with an admin, a member on a bound phone, its own role and designation, and its own words. */
async function tenant(name: string, word: string): Promise<Tenant> {
  const tenantId = await world.tenant(name);
  const adminPhone = newPhone();
  const adminUser = await world.user(tenantId, {
    name: `${name} Admin`,
    phone: adminPhone,
    designation: 'head',
    role: 'tenant_admin',
  });
  const memberPhone = newPhone();
  const memberUser = await world.user(tenantId, {
    name: `${name} Member`,
    phone: memberPhone,
    managerId: adminUser.id,
  });
  const memberDevice = newDevice();
  await world.signIn(memberPhone, memberDevice);
  const token = (await world.signIn(adminPhone)).accessToken;
  const role = await send(token, 'POST', '/v1/roles', {
    key: 'cross_role',
    name: named(`${name} role`),
    scope: 'team',
    permissions: ['user.view'],
  });
  const designation = await send(token, 'POST', '/v1/designations', {
    key: 'cross_designation',
    name: noun(`${name} title`),
    level: 5,
    defaultRole: 'cross_role',
    canHaveReports: false,
  });
  expect([role.statusCode, designation.statusCode]).toEqual([201, 201]);
  await send(token, 'PUT', '/v1/terminology', { 'term.account': noun(word) });
  await send(token, 'PATCH', '/v1/settings', { geofenceRadiusMeters: 250 });
  const fields = await send(token, 'PUT', '/v1/user-fields', {
    fields: [{ key: 'zone', type: 'short_text', label: named(`${word} zone`) }],
  });
  expect(fields.statusCode).toBe(200);
  return {
    tenantId,
    admin: { id: adminUser.id, phone: adminPhone },
    member: { id: memberUser.id, phone: memberPhone },
    memberDevice,
    roleId: role.json().id,
    designationId: designation.json().id,
    word,
  };
}

interface Fixture {
  /** What the route is, for tenancy: sign-in, a read of the caller's own tenant, an ID, a write. */
  kind: 'sign-in' | 'not tenant data' | 'own tenant' | 'by ID' | 'write' | 'platform console';
  run: () => Promise<void>;
}

/**
 * The vendor's console (decision D88): a tenant admin's token is no way in, A's tenant ID
 * included, and nothing of A's comes back. Sign-in routes answer B as anyone without an invitation.
 */
const consoleShutsB = (method: Method, url: string, payload?: object): Fixture => ({
  kind: 'platform console',
  run: async () => {
    const reply = await asB(method, url.replace(':id', a.tenantId), payload);
    expect([204, 400, 401]).toContain(reply.statusCode);
    holdsNothingOfA(reply);
  },
});

const FIXTURES: Record<string, Fixture> = {
  'GET /v1/openapi.json': {
    kind: 'not tenant data',
    run: async () => holdsNothingOfA(await send(undefined, 'GET', '/v1/openapi.json')),
  },
  'GET /v1/docs': {
    kind: 'not tenant data',
    run: async () => holdsNothingOfA(await send(undefined, 'GET', '/v1/docs')),
  },
  'GET /v1/docs/start.js': {
    kind: 'not tenant data',
    run: async () => {
      const reply = await send(undefined, 'GET', '/v1/docs/start.js');
      expect(reply.statusCode).toBe(200);
    },
  },
  'GET /v1/docs/scalar.js': {
    kind: 'not tenant data',
    run: async () => {
      const reply = await send(undefined, 'GET', '/v1/docs/scalar.js');
      expect(reply.statusCode).toBe(200);
    },
  },
  'POST /auth/v1/oauth/token': {
    kind: 'sign-in',
    run: async () => {
      // A's client ID with a guessed secret buys nothing.
      const reply = await send(undefined, 'POST', '/auth/v1/oauth/token', {
        grant_type: 'client_credentials',
        client_id: aApiClient.clientId,
        client_secret: 'a guess at the secret',
      });
      expect(reply.statusCode).toBe(401);
      holdsNothingOfA(reply);
    },
  },
  'GET /v1/bulk/fields': {
    kind: 'own tenant',
    run: async () => {
      for (const target of ['users', 'items', 'ledger-entries', 'external-metrics']) {
        holdsNothingOfA(await asB('GET', `/v1/bulk/fields?target=${target}`));
      }
    },
  },
  ...Object.fromEntries(
    (['users', 'accounts', 'items', 'ledger-entries', 'external-metrics'] as const).map(
      (target) => [
        `POST /v1/bulk/${target}`,
        {
          kind: 'write',
          run: async () => {
            // B's rows reach only B: a code of A's is a code nobody has, and nothing of A's comes back.
            const reply = await asB('POST', `/v1/bulk/${target}`, {
              ...(target === 'accounts' ? { accountType: 'customer' } : {}),
              rows: [
                { code: 'A-ONLY', account_code: 'A-ONLY', employee_code: 'A-ONLY', name: 'B row' },
              ],
            });
            expect([200, 400]).toContain(reply.statusCode);
            holdsNothingOfA(reply);
          },
        } satisfies Fixture,
      ],
    ),
  ),
  'GET /v1/api-clients': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/api-clients')),
  },
  'POST /v1/api-clients': {
    kind: 'write',
    run: async () => {
      const reply = await asB('POST', '/v1/api-clients', {
        id: newId(),
        name: 'B ERP',
        scopes: ['people:read'],
      });
      expect(reply.statusCode, reply.body).toBe(201);
      holdsNothingOfA(reply);
    },
  },
  'POST /v1/api-clients/:id/rotate': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('POST', `/v1/api-clients/${id}/rotate`), aApiClient.id),
  },
  'POST /v1/api-clients/:id/revoke': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('POST', `/v1/api-clients/${id}/revoke`), aApiClient.id),
  },
  'GET /v1/webhooks': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/webhooks')),
  },
  'POST /v1/webhooks': {
    kind: 'write',
    run: async () => {
      const reply = await asB('POST', '/v1/webhooks', {
        id: newId(),
        url: NOWHERE_HOOK,
        events: ['user.created'],
      });
      expect(reply.statusCode, reply.body).toBe(201);
      holdsNothingOfA(reply);
    },
  },
  'PATCH /v1/webhooks/:id': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere((id) => asB('PATCH', `/v1/webhooks/${id}`, { status: 'paused' }), aWebhookId),
  },
  'POST /v1/webhooks/:id/rotate': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('POST', `/v1/webhooks/${id}/rotate`), aWebhookId),
  },
  'POST /v1/webhooks/:id/test': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('POST', `/v1/webhooks/${id}/test`), aWebhookId),
  },
  'GET /v1/webhooks/:id/deliveries': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/webhooks/${id}/deliveries`), aWebhookId),
  },
  'POST /v1/webhooks/:id/messages/:messageId/replay': {
    kind: 'by ID',
    run: async () => {
      await sameAsNowhere(
        (id) => asB('POST', `/v1/webhooks/${id}/messages/${aWebhookMessageId}/replay`),
        aWebhookId,
      );
      // B's own webhook can't send A's message again either.
      const mine = newId();
      await asB('POST', '/v1/webhooks', { id: mine, url: NOWHERE_HOOK, events: ['user.created'] });
      await sameAsNowhere(
        (id) => asB('POST', `/v1/webhooks/${mine}/messages/${id}/replay`),
        aWebhookMessageId,
      );
    },
  },
  'GET /v1/data-exports': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/data-exports')),
  },
  'POST /v1/data-exports': {
    kind: 'write',
    run: async () => {
      const reply = await asB('POST', '/v1/data-exports', { id: newId() });
      expect(reply.statusCode, reply.body).toBe(201);
      holdsNothingOfA(reply);
    },
  },
  'GET /v1/data-exports/signing-key': {
    kind: 'not tenant data',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/data-exports/signing-key')),
  },
  'GET /v1/data-exports/:id': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/data-exports/${id}`), aDataExportId),
  },
  'GET /v1/me/data-requests': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asBPhone('GET', '/v1/me/data-requests')),
  },
  'POST /v1/me/data-requests': {
    kind: 'write',
    run: async () => {
      const reply = await asBPhone('POST', '/v1/me/data-requests', {
        id: newId(),
        kind: 'correction',
      });
      expect(reply.statusCode, reply.body).toBe(201);
      holdsNothingOfA(reply);
    },
  },
  'GET /v1/data-requests': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/data-requests?status=all')),
  },
  'POST /v1/data-requests': {
    kind: 'write',
    run: () =>
      sameAsNowhere(
        (id) => asB('POST', '/v1/data-requests', { id: newId(), userId: id, kind: 'erasure' }),
        a.member.id,
      ),
  },
  'GET /v1/data-requests/:id': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/data-requests/${id}`), aDataRequestId),
  },
  'POST /v1/data-requests/:id/archive': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere((id) => asB('POST', `/v1/data-requests/${id}/archive`), aDataRequestId),
  },
  'POST /v1/data-requests/:id/close': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', `/v1/data-requests/${id}/close`, { outcome: 'refused', response: 'No' }),
        aDataRequestId,
      ),
  },
  'GET /health': {
    kind: 'not tenant data',
    run: async () => holdsNothingOfA(await send(undefined, 'GET', '/health')),
  },
  'GET /ready': {
    kind: 'not tenant data',
    run: async () => holdsNothingOfA(await send(undefined, 'GET', '/ready')),
  },
  'GET /auth/v1/jwks': {
    kind: 'not tenant data',
    run: async () => holdsNothingOfA(await send(undefined, 'GET', '/auth/v1/jwks')),
  },
  'POST /platform/v1/setup': consoleShutsB('POST', '/platform/v1/setup', {
    token: 'x'.repeat(43),
    password: 'a long enough password',
  }),
  'POST /platform/v1/setup/confirm': consoleShutsB('POST', '/platform/v1/setup/confirm', {
    token: 'x'.repeat(43),
    code: '123456',
  }),
  'POST /platform/v1/session': consoleShutsB('POST', '/platform/v1/session', {
    email: 'admin@b.example',
    password: 'a long enough password',
    code: '123456',
  }),
  'POST /platform/v1/session/refresh': consoleShutsB('POST', '/platform/v1/session/refresh'),
  'POST /platform/v1/session/logout': consoleShutsB('POST', '/platform/v1/session/logout'),
  'GET /platform/v1/me': consoleShutsB('GET', '/platform/v1/me'),
  'GET /platform/v1/staff': consoleShutsB('GET', '/platform/v1/staff'),
  'POST /platform/v1/staff': consoleShutsB('POST', '/platform/v1/staff', {
    id: newId(),
    email: 'b@b.example',
    name: 'B Person',
    role: 'platform_admin',
  }),
  'POST /platform/v1/staff/:id/disable': consoleShutsB('POST', '/platform/v1/staff/:id/disable'),
  'POST /platform/v1/staff/:id/reset': consoleShutsB('POST', '/platform/v1/staff/:id/reset'),
  'POST /platform/v1/me/password': consoleShutsB('POST', '/platform/v1/me/password', {
    currentPassword: 'b password b password',
    newPassword: 'another b password b',
    code: '123456',
  }),
  'GET /platform/v1/tenants': consoleShutsB('GET', '/platform/v1/tenants'),
  'GET /platform/v1/tenants/:id': consoleShutsB('GET', '/platform/v1/tenants/:id'),
  'POST /platform/v1/tenants': consoleShutsB('POST', '/platform/v1/tenants', {
    id: newId(),
    name: 'B Made This',
    slug: 'b-made-this',
    template: 'generic',
    admin: { name: 'B Admin', phone: '+919999999999' },
  }),
  'POST /platform/v1/tenants/:id/suspend': consoleShutsB(
    'POST',
    '/platform/v1/tenants/:id/suspend',
    { reason: 'B tries to close A' },
  ),
  'POST /platform/v1/tenants/:id/reactivate': consoleShutsB(
    'POST',
    '/platform/v1/tenants/:id/reactivate',
  ),
  'POST /platform/v1/tenants/:id/terminate': consoleShutsB(
    'POST',
    '/platform/v1/tenants/:id/terminate',
    { reason: 'B tries to end A', confirmSlug: 'alpha' },
  ),
  'POST /platform/v1/tenants/:id/undo-termination': consoleShutsB(
    'POST',
    '/platform/v1/tenants/:id/undo-termination',
  ),
  'GET /platform/v1/tenants/:id/data-exports': consoleShutsB(
    'GET',
    '/platform/v1/tenants/:id/data-exports',
  ),
  'POST /platform/v1/tenants/:id/data-exports': consoleShutsB(
    'POST',
    '/platform/v1/tenants/:id/data-exports',
    { id: newId() },
  ),
  'GET /platform/v1/tenants/:id/data-exports/:exportId': consoleShutsB(
    'GET',
    `/platform/v1/tenants/:id/data-exports/${newId()}`,
  ),
  'GET /platform/v1/plans': consoleShutsB('GET', '/platform/v1/plans'),
  'POST /platform/v1/plans': consoleShutsB('POST', '/platform/v1/plans', {
    id: newId(),
    key: 'b_plan',
    name: { en: 'B plan', hi: 'B plan' },
    priceMonth: '1',
    priceYear: '10',
    modules: ['core'],
  }),
  'PUT /platform/v1/plans/:id': consoleShutsB('PUT', `/platform/v1/plans/${newId()}`, {
    key: 'b_plan',
    name: { en: 'B plan', hi: 'B plan' },
    priceMonth: '1',
    priceYear: '10',
    modules: ['core'],
  }),
  'GET /platform/v1/tenants/:id/entitlements': consoleShutsB(
    'GET',
    '/platform/v1/tenants/:id/entitlements',
  ),
  'PUT /platform/v1/tenants/:id/plan': consoleShutsB('PUT', '/platform/v1/tenants/:id/plan', {
    planId: null,
    extraModules: ['orders'],
  }),
  'GET /platform/v1/tenants/:id/usage': consoleShutsB('GET', '/platform/v1/tenants/:id/usage'),
  'POST /platform/v1/tenants/:id/second-factor-resets': consoleShutsB(
    'POST',
    '/platform/v1/tenants/:id/second-factor-resets',
    { phone: '9000000001', reason: 'Checking' },
  ),
  'GET /platform/v1/billing/settings': consoleShutsB('GET', '/platform/v1/billing/settings'),
  'PUT /platform/v1/billing/settings': consoleShutsB('PUT', '/platform/v1/billing/settings', {
    seller: {
      legalName: 'Anyone',
      gstin: null,
      address: 'Somewhere in Pune',
      stateCode: '27',
      email: 'b@example.com',
      sac: '998314',
    },
    invoicePrefix: 'B',
    gstRate: '18',
    paymentTermsDays: 15,
    graceDays: 7,
    readOnlyDays: 14,
  }),
  'GET /platform/v1/tenants/:id/billing': consoleShutsB('GET', '/platform/v1/tenants/:id/billing'),
  'PUT /platform/v1/tenants/:id/billing-account': consoleShutsB(
    'PUT',
    '/platform/v1/tenants/:id/billing-account',
    { legalName: 'B', address: 'Somewhere in Pune', stateCode: '27', email: 'b@example.com' },
  ),
  'PUT /platform/v1/tenants/:id/subscription': consoleShutsB(
    'PUT',
    '/platform/v1/tenants/:id/subscription',
    { planId: newId(), cycle: 'month' },
  ),
  'POST /platform/v1/tenants/:id/subscription/cancel': consoleShutsB(
    'POST',
    '/platform/v1/tenants/:id/subscription/cancel',
    { reason: 'Ending it' },
  ),
  'POST /platform/v1/tenants/:id/mandate': consoleShutsB(
    'POST',
    '/platform/v1/tenants/:id/mandate',
  ),
  'GET /platform/v1/health': consoleShutsB('GET', '/platform/v1/health'),
  'GET /platform/v1/announcements': consoleShutsB('GET', '/platform/v1/announcements'),
  'POST /platform/v1/announcements': consoleShutsB('POST', '/platform/v1/announcements', {
    id: newId(),
  }),
  'POST /platform/v1/announcements/:id/withdraw': consoleShutsB(
    'POST',
    '/platform/v1/announcements/:id/withdraw',
  ),
  'GET /platform/v1/support-grants': consoleShutsB('GET', '/platform/v1/support-grants'),
  'POST /platform/v1/support-grants': consoleShutsB('POST', '/platform/v1/support-grants', {
    tenantId: newId(),
    reason: 'B trying to ask for support',
  }),
  'POST /platform/v1/support-grants/:id/approve': consoleShutsB(
    'POST',
    '/platform/v1/support-grants/:id/approve',
  ),
  'POST /platform/v1/support-grants/:id/end': consoleShutsB(
    'POST',
    '/platform/v1/support-grants/:id/end',
  ),
  'POST /platform/v1/support-grants/:id/enter': consoleShutsB(
    'POST',
    '/platform/v1/support-grants/:id/enter',
  ),
  'GET /platform/v1/invoices': consoleShutsB('GET', '/platform/v1/invoices'),
  'GET /platform/v1/invoices/:id': consoleShutsB('GET', `/platform/v1/invoices/${newId()}`),
  'GET /platform/v1/invoices/:id/pdf': consoleShutsB('GET', `/platform/v1/invoices/${newId()}/pdf`),
  'POST /platform/v1/invoices/:id/payments': consoleShutsB(
    'POST',
    `/platform/v1/invoices/${newId()}/payments`,
    { id: newId(), amount: '1', method: 'upi', receivedOn: '2026-10-25' },
  ),
  'GET /platform/v1/templates': consoleShutsB('GET', '/platform/v1/templates'),
  'GET /platform/v1/cells': consoleShutsB('GET', '/platform/v1/cells'),
  'POST /auth/v1/otp/request': {
    kind: 'sign-in',
    run: async () => {
      // A's number is answered like a number nobody has (M1, rule 2).
      const theirs = await send(undefined, 'POST', '/auth/v1/otp/request', {
        phone: a.admin.phone,
      });
      const nobody = await send(undefined, 'POST', '/auth/v1/otp/request', { phone: newPhone() });
      expect(theirs.statusCode).toBe(202);
      expect(theirs.json()).toEqual(nobody.json());
    },
  },
  'POST /auth/v1/otp/verify': {
    kind: 'sign-in',
    run: async () => {
      // B's admin is asked for the authenticator next, for B (decision D91).
      const verified = await world.verify(b.admin.phone);
      expect(verified.json()).toMatchObject({
        status: 'second_factor',
        tenant: { id: b.tenantId },
      });
      holdsNothingOfA(verified);
    },
  },
  'POST /auth/v1/totp/setup': {
    kind: 'sign-in',
    run: async () => {
      // A ticket of B's sets up B's admin's own authenticator; anything else is no ticket at all.
      const verified = (await world.verify(b.admin.phone)).json();
      const fresh = await send(undefined, 'POST', '/auth/v1/totp/setup', {
        ticket: verified.ticket,
      });
      expect([200, 409]).toContain(fresh.statusCode);
      holdsNothingOfA(fresh);
      const forged = await send(undefined, 'POST', '/auth/v1/totp/setup', {
        ticket: 'x'.repeat(43),
      });
      expect(forged.json().error.code).toBe('OTP_EXPIRED');
    },
  },
  'POST /auth/v1/totp/verify': {
    kind: 'sign-in',
    run: async () => {
      const verified = (await world.verify(b.admin.phone)).json();
      const signedIn = await world.secondFactor(b.admin.phone, verified);
      expect(JSON.stringify(signedIn)).not.toContain(a.tenantId);
      const forged = await send(undefined, 'POST', '/auth/v1/totp/verify', {
        ticket: 'x'.repeat(43),
        code: '123456',
      });
      expect(forged.json().error.code).toBe('OTP_EXPIRED');
    },
  },
  // A person's own authenticator (decision D101): B's admin reaches only their own, and A's
  // people never appear.
  'GET /auth/v1/authenticator': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/auth/v1/authenticator')),
  },
  'POST /auth/v1/authenticator/setup': {
    kind: 'own tenant',
    run: async () => {
      const reply = await asB('POST', '/auth/v1/authenticator/setup');
      expect(reply.json().error.code).toBe('CONFLICT');
      holdsNothingOfA(reply);
    },
  },
  'POST /auth/v1/authenticator/confirm': {
    kind: 'own tenant',
    run: async () => {
      const reply = await asB('POST', '/auth/v1/authenticator/confirm', { code: '123456' });
      expect(reply.json().error.code).toBe('CONFLICT');
      holdsNothingOfA(reply);
    },
  },
  'POST /auth/v1/authenticator/remove': {
    kind: 'own tenant',
    run: async () => {
      const reply = await asB('POST', '/auth/v1/authenticator/remove', { code: '123456' });
      expect(reply.json().error.code).toBe('CONFLICT');
      holdsNothingOfA(reply);
    },
  },
  'POST /auth/v1/select-tenant': {
    kind: 'sign-in',
    run: async () => {
      // Someone in B and a third tenant can't choose A with their ticket.
      const phone = newPhone();
      await world.member(phone, [b.tenantId, await world.tenant('Third Traders')]);
      await sameAsNowhere(async (tenantId) => {
        const ticket = (await world.verify(phone)).json().ticket as string;
        return send(undefined, 'POST', '/auth/v1/select-tenant', { ticket, tenantId });
      }, a.tenantId);
    },
  },
  'POST /auth/v1/token/refresh': {
    kind: 'sign-in',
    run: async () => {
      const { refreshToken } = await world.signIn(b.admin.phone);
      const refreshed = await send(undefined, 'POST', '/auth/v1/token/refresh', { refreshToken });
      expect(refreshed.json()).toMatchObject({ tenant: { id: b.tenantId } });
      holdsNothingOfA(refreshed);
    },
  },
  'POST /auth/v1/switch-tenant': {
    kind: 'sign-in',
    run: () =>
      sameAsNowhere(async (tenantId) => {
        const { refreshToken } = await world.signIn(b.admin.phone);
        return send(undefined, 'POST', '/auth/v1/switch-tenant', { refreshToken, tenantId });
      }, a.tenantId),
  },
  'POST /auth/v1/logout': {
    kind: 'sign-in',
    run: async () => {
      const { refreshToken } = await world.signIn(b.admin.phone);
      expect((await send(undefined, 'POST', '/auth/v1/logout', { refreshToken })).statusCode).toBe(
        204,
      );
    },
  },
  'GET /v1/me': {
    kind: 'own tenant',
    run: async () => {
      const me = await asB('GET', '/v1/me');
      expect(me.json()).toMatchObject({ tenantId: b.tenantId, userId: b.admin.id });
      holdsNothingOfA(me);
    },
  },
  'GET /v1/config': {
    kind: 'own tenant',
    run: async () => {
      const config = await asB('GET', '/v1/config');
      expect(config.statusCode).toBe(200);
      expect(config.body).toContain(b.word);
      holdsNothingOfA(config);
    },
  },
  'PATCH /v1/settings': {
    kind: 'write',
    run: async () => {
      expect((await asB('PATCH', '/v1/settings', { geofenceRadiusMeters: 400 })).statusCode).toBe(
        200,
      );
    },
  },
  'GET /v1/organisation': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/organisation')),
  },
  'PATCH /v1/organisation': {
    kind: 'write',
    run: async () => {
      const renamed = await asB('PATCH', '/v1/organisation', { name: `${b.word} Traders` });
      expect(renamed.statusCode).toBe(200);
      holdsNothingOfA(renamed);
    },
  },
  'PUT /v1/organisation/logo': {
    kind: 'write',
    run: async () => {
      const logo = await sharp({
        create: { width: 64, height: 64, channels: 3, background: '#0f6e6e' },
      })
        .png()
        .toBuffer();
      const set = await app.inject({
        method: 'PUT',
        url: '/v1/organisation/logo',
        headers: { authorization: `Bearer ${bToken}`, 'content-type': 'image/png' },
        payload: logo,
      });
      expect(set.statusCode).toBe(200);
      holdsNothingOfA(set);
    },
  },
  'DELETE /v1/organisation/logo': {
    kind: 'write',
    run: async () => {
      const removed = await asB('DELETE', '/v1/organisation/logo');
      expect(removed.statusCode).toBe(200);
      holdsNothingOfA(removed);
    },
  },
  'GET /v1/terminology': {
    kind: 'own tenant',
    run: async () => {
      const words = await asB('GET', '/v1/terminology');
      expect(words.body).toContain(b.word);
      holdsNothingOfA(words);
    },
  },
  'PUT /v1/terminology': {
    kind: 'write',
    run: async () => {
      const replaced = await asB('PUT', '/v1/terminology', { 'term.account': noun(b.word) });
      expect(replaced.statusCode).toBe(200);
      holdsNothingOfA(replaced);
    },
  },
  'GET /v1/roles': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/roles')),
  },
  'POST /v1/roles': {
    kind: 'write',
    run: async () => {
      const created = await asB('POST', '/v1/roles', {
        key: 'b_only_role',
        name: named('B only'),
        scope: 'self',
        permissions: ['user.view'],
      });
      expect(created.statusCode).toBe(201);
      holdsNothingOfA(created);
    },
  },
  'PATCH /v1/roles/:id': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('PATCH', `/v1/roles/${id}`, { name: named('Taken over') }),
        a.roleId,
      ),
  },
  'GET /v1/designations': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/designations')),
  },
  'POST /v1/designations': {
    kind: 'write',
    run: async () => {
      const created = await asB('POST', '/v1/designations', {
        key: 'b_only_title',
        name: noun('B title'),
        level: 6,
        defaultRole: 'cross_role',
        canHaveReports: false,
      });
      expect(created.statusCode).toBe(201);
      holdsNothingOfA(created);
    },
  },
  'PATCH /v1/designations/:id': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere((id) => asB('PATCH', `/v1/designations/${id}`, { level: 7 }), a.designationId),
  },
  'GET /v1/users': {
    kind: 'own tenant',
    run: async () => {
      holdsNothingOfA(await asB('GET', '/v1/users'));
      // A cursor naming one of A's users still pages through B's.
      holdsNothingOfA(await asB('GET', `/v1/users?cursor=${a.member.id}`));
    },
  },
  'POST /v1/users': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (managerId) =>
          asB('POST', '/v1/users', {
            code: `X${newId().slice(-8)}`,
            name: 'Crossing Over',
            designation: 'manager',
            managerId,
          }),
        a.admin.id,
      ),
  },
  'GET /v1/users/:id': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/users/${id}`), a.member.id),
  },
  'PATCH /v1/users/:id': {
    kind: 'by ID',
    run: async () => {
      await sameAsNowhere(
        (id) => asB('PATCH', `/v1/users/${id}`, { name: 'Taken Over' }),
        a.member.id,
      );
      // Nor can B report one of its people to someone of A's.
      await sameAsNowhere(
        (managerId) => asB('PATCH', `/v1/users/${b.member.id}`, { managerId }),
        a.admin.id,
      );
    },
  },
  'POST /v1/users/:id/reset-device': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('POST', `/v1/users/${id}/reset-device`), a.member.id),
  },
  'POST /v1/users/:id/sign-out-everywhere': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere((id) => asB('POST', `/v1/users/${id}/sign-out-everywhere`), a.member.id),
  },
  'GET /v1/sync/pull': {
    kind: 'own tenant',
    run: async () => {
      const pulled = await asB('GET', '/v1/sync/pull?entities=users,territories');
      expect(pulled.statusCode).toBe(200);
      holdsNothingOfA(pulled);
      // A cursor A was given is no more use to B than one made up.
      const reused = await asB('GET', `/v1/sync/pull?entities=users&cursor=${aCursor}`);
      const madeUp = await asB('GET', '/v1/sync/pull?entities=users&cursor=bm90IGEgY3Vyc29y');
      expect(reused.statusCode).toBe(410);
      expect(errorOf(reused)).toEqual(errorOf(madeUp));
    },
  },
  'GET /v1/territories': {
    kind: 'own tenant',
    run: async () => {
      const listed = await asB('GET', '/v1/territories');
      expect(listed.statusCode).toBe(200);
      holdsNothingOfA(listed);
    },
  },
  'POST /v1/territories': {
    kind: 'write',
    run: async () => {
      await sameAsNowhere(
        (id) => asB('POST', '/v1/territories', { code: 'B-UNDER', name: 'Under', parentId: id }),
        aTerritoryId,
      );
      const created = await asB('POST', '/v1/territories', { code: 'B-TOP', name: 'B top' });
      expect(created.statusCode).toBe(201);
      holdsNothingOfA(created);
    },
  },
  'PATCH /v1/territories/:id': {
    kind: 'by ID',
    run: async () => {
      await sameAsNowhere(
        (id) => asB('PATCH', `/v1/territories/${id}`, { name: 'Taken over' }),
        aTerritoryId,
      );
      const own = await world.territory(b.tenantId, 'B-OWN');
      await sameAsNowhere(
        (id) => asB('PATCH', `/v1/territories/${own}`, { parentId: id }),
        aTerritoryId,
      );
    },
  },
  'POST /v1/imports': {
    kind: 'write',
    run: async () => {
      const uploaded = await upload(bToken, 'users', 'Employee code,Name\nB-1,Bravo One');
      expect(uploaded.statusCode).toBe(201);
      holdsNothingOfA(uploaded);
    },
  },
  'GET /v1/imports': {
    kind: 'own tenant',
    run: async () => {
      const listed = await asB('GET', '/v1/imports');
      expect(listed.statusCode).toBe(200);
      holdsNothingOfA(listed);
      holdsNothingOfA(await asB('GET', `/v1/imports?cursor=${aImportId}`));
    },
  },
  'GET /v1/imports/:id': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/imports/${id}`), aImportId),
  },
  'PUT /v1/imports/:id/mapping': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('PUT', `/v1/imports/${id}/mapping`, { mapping: { Name: 'name' } }),
        aImportId,
      ),
  },
  'POST /v1/imports/:id/commit': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('POST', `/v1/imports/${id}/commit`), aImportId),
  },
  'GET /v1/account-types': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/account-types')),
  },
  'POST /v1/account-types/:id/versions': {
    kind: 'by ID',
    run: async () => {
      const [own] = (await asB('GET', '/v1/account-types')).json().items;
      const definition = Object.fromEntries(
        Object.entries(own as object).filter(([key]) => key !== 'id' && key !== 'version'),
      );
      await sameAsNowhere(
        (id) => asB('POST', `/v1/account-types/${id}/versions`, { definition }),
        aTypeId,
      );
    },
  },
  'POST /v1/account-types': {
    kind: 'write',
    run: async () => {
      const [own] = (await asB('GET', '/v1/account-types')).json().items;
      const definition = Object.fromEntries(
        Object.entries(own as object).filter(([key]) => key !== 'id' && key !== 'version'),
      );
      const made = await asB('POST', '/v1/account-types', {
        id: newId(),
        definition: { ...definition, key: 'b_extra' },
      });
      expect(made.statusCode).toBe(201);
      holdsNothingOfA(made);
    },
  },
  'PUT /v1/territories/levels': {
    kind: 'write',
    run: async () => {
      const { levels } = (await asB('GET', '/v1/territories')).json();
      const saved = await asB('PUT', '/v1/territories/levels', {
        levels: levels.map((level: { key: string; name: unknown }) => ({
          key: level.key,
          name: level.name,
        })),
      });
      expect(saved.statusCode).toBe(200);
      holdsNothingOfA(saved);
    },
  },
  'GET /v1/metric-definitions': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/metric-definitions')),
  },
  'POST /v1/metrics': {
    kind: 'write',
    run: async () => {
      const made = await asB('POST', '/v1/metrics', {
        definition: {
          key: 'b_plan',
          name: noun('Plan done'),
          unit: 'percent',
          source: { type: 'plan_compliance_percent' },
        },
      });
      expect(made.statusCode).toBe(201);
      holdsNothingOfA(made);
    },
  },
  'PUT /v1/metrics/:key': {
    kind: 'write',
    run: async () => {
      const { metrics } = (await asB('GET', '/v1/metric-definitions')).json();
      const [first] = metrics;
      const changed = await asB('PUT', `/v1/metrics/${first.definition.key}`, {
        definition: first.definition,
        active: true,
        from: new Date().toISOString().slice(0, 10),
      });
      expect(changed.statusCode).toBe(200);
      holdsNothingOfA(changed);
    },
  },
  'PUT /v1/score': {
    kind: 'write',
    run: async () => {
      const { score } = (await asB('GET', '/v1/metric-definitions')).json();
      if (!score) return;
      const saved = await asB('PUT', '/v1/score', { definition: score });
      expect(saved.statusCode).toBe(200);
      holdsNothingOfA(saved);
    },
  },
  'GET /v1/configuration/export': {
    kind: 'own tenant',
    run: async () => {
      holdsNothingOfA(await asB('GET', '/v1/configuration/export'));
    },
  },
  'POST /v1/configuration/import/preview': {
    kind: 'write',
    run: async () => {
      const template = (await asB('GET', '/v1/configuration/export')).json();
      const plan = await asB('POST', '/v1/configuration/import/preview', { template });
      expect(plan.statusCode).toBe(200);
      holdsNothingOfA(plan);
    },
  },
  'POST /v1/configuration/import': {
    kind: 'write',
    run: async () => {
      const template = (await asB('GET', '/v1/configuration/export')).json();
      const imported = await asB('POST', '/v1/configuration/import', { template });
      expect(imported.statusCode).toBe(200);
      holdsNothingOfA(imported);
    },
  },
  'GET /v1/accounts': {
    kind: 'own tenant',
    run: async () => {
      holdsNothingOfA(await asB('GET', '/v1/accounts'));
      holdsNothingOfA(await asB('GET', `/v1/accounts?cursor=${aAccountId}`));
      holdsNothingOfA(await asB('GET', `/v1/accounts?territoryId=${aTerritoryId}`));
      holdsNothingOfA(await asB('GET', `/v1/accounts?userId=${a.member.id}`));
    },
  },
  'POST /v1/accounts': {
    kind: 'write',
    run: async () => {
      const account = (overrides: object) => ({
        id: newId(),
        type: 'customer',
        code: `B-${newId().slice(-8)}`,
        name: 'B shop',
        territoryId: bTerritoryId,
        ...overrides,
      });
      await sameAsNowhere(
        (id) => asB('POST', '/v1/accounts', account({ territoryId: id })),
        aTerritoryId,
      );
      await sameAsNowhere(
        (id) => asB('POST', '/v1/accounts', account({ slots: { manager: id } })),
        a.member.id,
      );
      const created = await asB('POST', '/v1/accounts', account({}));
      expect(created.statusCode).toBe(201);
      holdsNothingOfA(created);
    },
  },
  'GET /v1/accounts/:id/overview': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/accounts/${id}/overview`), aAccountId),
  },
  'PATCH /v1/accounts/:id': {
    kind: 'by ID',
    run: async () => {
      await sameAsNowhere(
        (id) => asB('PATCH', `/v1/accounts/${id}`, { name: 'Taken over' }),
        aAccountId,
      );
      // B's own account, pointed at A's territory or A's people.
      await sameAsNowhere(
        (id) => asB('PATCH', `/v1/accounts/${bAccountId}`, { territoryId: id }),
        aTerritoryId,
      );
      await sameAsNowhere(
        (id) => asB('PATCH', `/v1/accounts/${bAccountId}`, { slots: { holders: { manager: id } } }),
        a.member.id,
      );
    },
  },
  'POST /v1/accounts/:id/contacts': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('POST', `/v1/accounts/${id}/contacts`, { id: newId(), name: 'Someone' }),
        aAccountId,
      ),
  },
  'PATCH /v1/accounts/:id/contacts/:contactId': {
    kind: 'by ID',
    run: async () => {
      await sameAsNowhere(
        (id) => asB('PATCH', `/v1/accounts/${id}/contacts/${aContactId}`, { name: 'Taken' }),
        aAccountId,
      );
      await sameAsNowhere(
        (id) => asB('PATCH', `/v1/accounts/${bAccountId}/contacts/${id}`, { name: 'Taken' }),
        aContactId,
      );
    },
  },
  'POST /v1/accounts/:id/location-proposals': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', `/v1/accounts/${id}/location-proposals`, {
            id: newId(),
            lat: 12.97,
            lng: 77.59,
            accuracy: 10,
            capturedAt: new Date().toISOString(),
            proposedAt: new Date().toISOString(),
          }),
        aAccountId,
      ),
  },
  'GET /v1/approvals/inbox': {
    kind: 'own tenant',
    run: async () => {
      holdsNothingOfA(await asB('GET', '/v1/approvals/inbox'));
      holdsNothingOfA(await asB('GET', `/v1/approvals/inbox?cursor=${aApprovalId}`));
    },
  },
  'GET /v1/approvals/mine': {
    kind: 'own tenant',
    run: async () => {
      holdsNothingOfA(await asB('GET', '/v1/approvals/mine'));
      holdsNothingOfA(await asB('GET', `/v1/approvals/mine?cursor=${aApprovalId}`));
    },
  },
  'POST /v1/approvals/decisions': {
    kind: 'by ID',
    run: async () => {
      // Each item answers on its own, so A's request must answer as one that doesn't exist.
      const decide = (id: string) =>
        asB('POST', '/v1/approvals/decisions', { items: [{ id, version: 1 }] });
      const theirs = await decide(aApprovalId);
      const nowhere = await decide(newId());
      expect(theirs.statusCode).toBe(200);
      expect(theirs.json().results[0].error).toEqual(nowhere.json().results[0].error);
      expect(theirs.json().results[0].error.code).toBe('NOT_FOUND');
    },
  },
  'GET /v1/approvals/:instanceId': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/approvals/${id}`), aApprovalId),
  },
  'POST /v1/approvals/:instanceId/decision': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('POST', `/v1/approvals/${id}/decision`, { decision: 'approve', version: 1 }),
        aApprovalId,
      ),
  },
  'POST /v1/approvals/:instanceId/cancel': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('POST', `/v1/approvals/${id}/cancel`), aApprovalId),
  },
  'GET /v1/workflows': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/workflows')),
  },
  'PUT /v1/workflows/fallback': {
    kind: 'write',
    run: async () => {
      const set = await asB('PUT', '/v1/workflows/fallback', { role: 'tenant_admin' });
      expect(set.statusCode).toBe(200);
      holdsNothingOfA(set);
    },
  },
  'PUT /v1/workflows/:requestType': {
    kind: 'write',
    run: async () => {
      const current = (await asB('GET', '/v1/workflows'))
        .json()
        .chains.find((chain: { requestType: string }) => chain.requestType === 'journey_plan');
      const set = await asB('PUT', '/v1/workflows/journey_plan', {
        steps: [{ approver: { type: 'reporting_manager', level: 1 } }],
        version: current.version,
      });
      expect(set.statusCode).toBe(200);
      holdsNothingOfA(set);
    },
  },
  'POST /v1/media/presign': {
    kind: 'write',
    run: async () => {
      const presigned = await asB('POST', '/v1/media/presign', {
        id: newId(),
        kind: 'evidence',
        contentType: 'image/jpeg',
        size: 4,
        sha256: 'a'.repeat(64),
      });
      expect(presigned.statusCode).toBe(200);
      holdsNothingOfA(presigned);
    },
  },
  'POST /v1/media/:id/confirm': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', `/v1/media/${id}/confirm`, {
            capturedAt: new Date().toISOString(),
            source: 'camera',
          }),
        aPhotoId,
      ),
  },
  'GET /v1/media/:id/url': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/media/${id}/url?variant=original`), aPhotoId),
  },
  'GET /v1/forms': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/forms')),
  },
  'POST /v1/forms': {
    kind: 'write',
    run: async () => {
      const created = await asB('POST', '/v1/forms', {
        definition: {
          key: 'b_survey',
          name: { en: { one: 'B survey', other: 'B surveys' }, hi: { one: 'B', other: 'B' } },
          icon: 'clipboard-list',
          fields: [{ key: 'notes', type: 'long_text', label: named('Notes') }],
        },
      });
      expect(created.statusCode).toBe(201);
      holdsNothingOfA(created);
    },
  },
  'POST /v1/forms/:id/versions': {
    kind: 'by ID',
    run: async () => {
      const [own] = (await asB('GET', '/v1/forms')).json().items;
      const definition = Object.fromEntries(
        Object.entries(own as object).filter(([key]) => !['id', 'version', 'active'].includes(key)),
      );
      await sameAsNowhere((id) => asB('POST', `/v1/forms/${id}/versions`, { definition }), aFormId);
    },
  },
  'PATCH /v1/forms/:id': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('PATCH', `/v1/forms/${id}`, { active: false }), aFormId),
  },
  'POST /v1/shifts': {
    kind: 'write',
    run: async () => {
      const started = await asBPhone('POST', '/v1/shifts', {
        ...FIX,
        id: newId(),
        startedAt: new Date().toISOString(),
        consentVersion: '1',
      });
      expect(started.statusCode).toBe(201);
      holdsNothingOfA(started);
    },
  },
  'GET /v1/shifts/current': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asBPhone('GET', '/v1/shifts/current')),
  },
  'GET /v1/shifts': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/shifts?userId=${id}`), a.member.id),
  },
  'POST /v1/shifts/:id/end': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('POST', `/v1/shifts/${id}/end`, { ...FIX, endedAt: new Date().toISOString() }),
        aShiftId,
      ),
  },
  'POST /v1/shifts/:id/pauses': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', `/v1/shifts/${id}/pauses`, {
            id: newId(),
            pausedAt: new Date().toISOString(),
            reason: 'Lunch',
          }),
        aShiftId,
      ),
  },
  'POST /v1/shifts/:id/pauses/:pauseId/resume': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', `/v1/shifts/${id === aPauseId ? aShiftId : newId()}/pauses/${id}/resume`, {
            resumedAt: new Date().toISOString(),
          }),
        aPauseId,
      ),
  },
  'POST /v1/locations/batch': {
    kind: 'write',
    run: async () => {
      const point = (shiftId: string) => ({
        id: newId(),
        shiftId,
        capturedAt: new Date().toISOString(),
        location: FIX.location,
        accuracy: 10,
        mocked: false,
        source: 'foreground',
      });
      const theirs = await asBPhone('POST', '/v1/locations/batch', { points: [point(aShiftId)] });
      const nowhere = await asBPhone('POST', '/v1/locations/batch', { points: [point(newId())] });
      expect(theirs.json().rejected[0].reason).toBe('NOT_YOUR_SHIFT');
      expect(nowhere.json().rejected[0].reason).toBe('NOT_YOUR_SHIFT');
      holdsNothingOfA(theirs);
    },
  },
  'GET /v1/attendance': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('GET', `/v1/attendance?userId=${id}&period=${NEXT_MONTH.slice(0, 7)}`),
        a.member.id,
      ),
  },
  'POST /v1/visits': {
    kind: 'by ID',
    run: async () => {
      await bOnShift();
      await sameAsNowhere(
        (id) =>
          asBPhone('POST', '/v1/visits', {
            id: newId(),
            accountId: id,
            checkedInAt: new Date().toISOString(),
            fix: { ...FIX, capturedAt: new Date().toISOString() },
          }),
        aAccountId,
      );
    },
  },
  'GET /v1/visits/current': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asBPhone('GET', '/v1/visits/current')),
  },
  'POST /v1/visits/:id/check-out': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asBPhone('POST', `/v1/visits/${id}/check-out`, {
            checkedOutAt: new Date().toISOString(),
          }),
        aVisitId,
      ),
  },
  'POST /v1/submissions': {
    kind: 'by ID',
    run: async () => {
      await bOnShift();
      const submission = (overrides: object) => ({
        id: newId(),
        form: { key: 'meeting', version: 1 },
        capturedAt: new Date().toISOString(),
        fix: { ...FIX, capturedAt: new Date().toISOString() },
        values: { location_name: 'Hall', attendees: 3, topic: 'Stock', outcome: 'Fine' },
        photos: [],
        ...overrides,
      });
      await sameAsNowhere(
        (id) => asBPhone('POST', '/v1/submissions', submission({ photos: [id] })),
        aPhotoId,
      );
      await sameAsNowhere(
        (id) =>
          asBPhone(
            'POST',
            '/v1/submissions',
            submission({ form: { key: 'customer_visit', version: 1 }, visitId: id }),
          ),
        aVisitId,
      );
    },
  },
  'GET /v1/submissions': {
    kind: 'by ID',
    run: async () => {
      await sameAsNowhere((id) => asB('GET', `/v1/submissions?userId=${id}`), a.member.id);
      await sameAsNowhere((id) => asB('GET', `/v1/submissions?accountId=${id}`), aAccountId);
    },
  },
  'GET /v1/reviews/queue': {
    kind: 'own tenant',
    run: async () => {
      for (const status of ['pending', 'approved', 'rejected']) {
        holdsNothingOfA(await asB('GET', `/v1/reviews/queue?status=${status}`));
      }
      holdsNothingOfA(await asB('GET', `/v1/reviews/queue?userId=${a.member.id}`));
      holdsNothingOfA(await asB('GET', `/v1/reviews/queue?accountId=${aAccountId}`));
    },
  },
  'POST /v1/submissions/:id/review': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', `/v1/submissions/${id}/review`, {
            decision: 'rejected',
            note: 'Not here',
          }),
        aSubmissionId,
      ),
  },
  'POST /v1/reviews/bulk': {
    kind: 'write',
    run: async () => {
      const theirs = await asB('POST', '/v1/reviews/bulk', { ids: [aSubmissionId] });
      expect(theirs.json()).toEqual({
        approved: [],
        skipped: [{ id: aSubmissionId, reason: 'NOT_FOUND' }],
      });
      holdsNothingOfA({ ...theirs, body: theirs.body.replace(aSubmissionId, '') } as Reply);
    },
  },
  'GET /v1/review-rules': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/review-rules')),
  },
  'PUT /v1/review-rules': {
    kind: 'write',
    run: async () => {
      const set = await asB('PUT', '/v1/review-rules', { autoApproval: false, delayHours: 12 });
      expect(set.statusCode).toBe(200);
      holdsNothingOfA(set);
    },
  },
  'GET /v1/routes': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/routes?userId=${id}`), a.member.id),
  },
  'POST /v1/routes': {
    kind: 'by ID',
    run: async () => {
      const route = (overrides: object) => ({
        id: newId(),
        userId: b.member.id,
        name: 'Market road',
        recurrence: { kind: 'weekdays', days: [1] },
        accountIds: [bAccountId],
        ...overrides,
      });
      await sameAsNowhere((id) => asB('POST', '/v1/routes', route({ userId: id })), a.member.id);
      await sameAsNowhere(
        (id) => asB('POST', '/v1/routes', route({ accountIds: [id] })),
        aAccountId,
      );
    },
  },
  'PATCH /v1/routes/:id': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('PATCH', `/v1/routes/${id}`, { name: 'Taken' }), aRouteId),
  },
  'POST /v1/plans/generate': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('POST', '/v1/plans/generate', { userId: id, period: NEXT_MONTH.slice(0, 7) }),
        a.member.id,
      ),
  },
  'POST /v1/plans/submit': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('POST', '/v1/plans/submit', { userId: id, period: NEXT_MONTH.slice(0, 7) }),
        a.member.id,
      ),
  },
  'GET /v1/plan-items': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('GET', `/v1/plan-items?userId=${id}&period=${NEXT_MONTH.slice(0, 7)}`),
        a.member.id,
      ),
  },
  'POST /v1/plan-items': {
    kind: 'by ID',
    run: async () => {
      const item = (overrides: object) => ({
        id: newId(),
        userId: b.member.id,
        accountId: bAccountId,
        date: NEXT_MONTH,
        ...overrides,
      });
      await sameAsNowhere((id) => asB('POST', '/v1/plan-items', item({ userId: id })), a.member.id);
      await sameAsNowhere(
        (id) => asB('POST', '/v1/plan-items', item({ accountId: id })),
        aAccountId,
      );
    },
  },
  'POST /v1/plan-items/:id/cancel': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('POST', `/v1/plan-items/${id}/cancel`), aPlanItemId),
  },
  'GET /v1/metrics': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/metrics')),
  },
  'GET /v1/targets': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', `/v1/targets?period=${TARGET_MONTH}`)),
  },
  'PUT /v1/targets': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('PUT', '/v1/targets', {
            period: TARGET_MONTH,
            sets: [{ userId: id, values: { visits: '1' }, version: 0 }],
          }),
        a.member.id,
      ),
  },
  'POST /v1/targets/lock': {
    kind: 'write',
    run: async () => {
      const lock = (id: string) =>
        asB('POST', '/v1/targets/lock', { period: TARGET_MONTH, userIds: [id] });
      const theirs = await lock(a.member.id);
      const nowhere = newId();
      expect(theirs.json().skipped).toEqual([{ userId: a.member.id, reason: 'OUT_OF_SCOPE' }]);
      expect((await lock(nowhere)).json().skipped).toEqual([
        { userId: nowhere, reason: 'OUT_OF_SCOPE' },
      ]);
    },
  },
  'POST /v1/targets/unlock': {
    kind: 'by ID',
    run: async () => {
      const unlock = (id: string) =>
        asB('POST', '/v1/targets/unlock', {
          userId: id,
          period: TARGET_MONTH,
          reason: 'Moved to another territory',
        });
      const theirs = await unlock(a.member.id);
      const nowhere = await unlock(newId());
      expect(theirs.statusCode).toBe(nowhere.statusCode);
      expect(errorOf(theirs)).toEqual(errorOf(nowhere));
    },
  },
  'POST /v1/targets/copy': {
    kind: 'write',
    run: async () => {
      const copy = (id: string) =>
        asB('POST', '/v1/targets/copy', {
          period: TARGET_MONTH,
          from: '2029-12',
          userIds: [id],
        });
      expect((await copy(a.member.id)).json().skipped).toEqual([
        { userId: a.member.id, reason: 'OUT_OF_SCOPE' },
      ]);
    },
  },
  'GET /v1/live': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/live')),
  },
  'GET /v1/account-pins': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/account-pins')),
  },
  'GET /v1/trails': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('GET', `/v1/trails?userId=${id}&date=${new Date().toISOString().slice(0, 10)}`),
        a.member.id,
      ),
  },
  'GET /v1/density': {
    kind: 'own tenant',
    run: async () =>
      holdsNothingOfA(
        await asB('GET', `/v1/density?period=${new Date().toISOString().slice(0, 7)}`),
      ),
  },
  'GET /v1/dashboard': {
    kind: 'own tenant',
    run: async () =>
      holdsNothingOfA(
        await asB('GET', `/v1/dashboard?period=${new Date().toISOString().slice(0, 7)}`),
      ),
  },
  'GET /v1/reports/:key': {
    kind: 'by ID',
    run: async () => {
      const month = new Date().toISOString().slice(0, 7);
      for (const key of ['activity_log', 'attendance_register', 'target_achievement']) {
        holdsNothingOfA(await asB('GET', `/v1/reports/${key}?period=${month}`));
        await sameAsNowhere(
          (id) => asB('GET', `/v1/reports/${key}?period=${month}&userId=${id}`),
          a.member.id,
        );
        await sameAsNowhere(
          (id) => asB('GET', `/v1/reports/${key}?period=${month}&managerId=${id}`),
          a.member.id,
        );
        await sameAsNowhere(
          (id) => asB('GET', `/v1/reports/${key}?period=${month}&territoryId=${id}`),
          aTerritoryId,
        );
      }
    },
  },
  'POST /v1/exports': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', '/v1/exports', {
            id: newId(),
            report: 'activity_log',
            filters: { period: new Date().toISOString().slice(0, 7), userId: id },
            format: 'xlsx',
          }),
        a.member.id,
      ),
  },
  'GET /v1/exports': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/exports')),
  },
  'GET /v1/exports/:id': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/exports/${id}`), aExportId),
  },
  'GET /v1/announcements': {
    kind: 'own tenant',
    run: async () => {
      for (const surface of ['web', 'mobile']) {
        const reply = await asB('GET', `/v1/announcements?surface=${surface}`);
        expect(reply.statusCode, reply.body).toBe(200);
        holdsNothingOfA(reply);
      }
    },
  },
  'GET /v1/support-grants': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/support-grants')),
  },
  'POST /v1/support-grants/:id/decision': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('POST', `/v1/support-grants/${id}/decision`, { approve: true }),
        aSupportGrantId,
      ),
  },
  'POST /v1/support-grants/:id/end': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('POST', `/v1/support-grants/${id}/end`), aSupportGrantId),
  },
  'GET /auth/v1/support/enter': {
    kind: 'sign-in',
    run: async () => {
      const reply = await send(undefined, 'GET', `/auth/v1/support/enter?code=${'x'.repeat(43)}`);
      expect(reply.headers.location).toMatch(/sign-in\?support=expired$/);
      holdsNothingOfA(reply);
    },
  },
  'GET /v1/sso': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/sso')),
  },
  'PUT /v1/sso': {
    kind: 'write',
    run: async () => {
      // B can't claim a domain for itself and so take A's people; B's own connection is B's.
      const reply = await asB('PUT', '/v1/sso', {
        settings: {
          protocol: 'oidc',
          issuer: 'https://idp.b.example/',
          clientId: 'b',
          clientSecret: 'b secret',
        },
        domains: ['b.example'],
        enabled: false,
        enforced: false,
      });
      expect(reply.statusCode, reply.body).toBe(200);
      holdsNothingOfA(reply);
    },
  },
  'POST /auth/v1/sso/discover': {
    kind: 'sign-in',
    run: async () =>
      holdsNothingOfA(
        await send(undefined, 'POST', '/auth/v1/sso/discover', { email: 'someone@a.example' }),
      ),
  },
  'GET /auth/v1/sso/:tenant/start': {
    kind: 'sign-in',
    run: async () => {
      // A has no connection: B's people can't start one there, and nothing of A's comes back.
      const reply = await send(undefined, 'GET', `/auth/v1/sso/t-${a.tenantId}/start`);
      expect(reply.headers.location).toMatch(/sign-in\?sso=unavailable$/);
      holdsNothingOfA(reply);
    },
  },
  'GET /auth/v1/sso/:tenant/oidc/callback': {
    kind: 'sign-in',
    run: async () => {
      const reply = await send(
        undefined,
        'GET',
        `/auth/v1/sso/t-${a.tenantId}/oidc/callback?code=x&state=${'y'.repeat(43)}`,
      );
      expect(reply.headers.location).toMatch(/sign-in\?sso=expired$/);
      // No session; only the spent binder is cleared (decision D101).
      expect(String(reply.headers['set-cookie'] ?? '')).not.toContain('_refresh=');
    },
  },
  'POST /auth/v1/sso/:tenant/saml/acs': {
    kind: 'sign-in',
    run: async () => {
      const reply = await send(undefined, 'POST', `/auth/v1/sso/t-${a.tenantId}/saml/acs`, {
        SAMLResponse: 'PHNhbWw+',
        RelayState: 'z'.repeat(43),
      });
      expect(reply.headers.location).toMatch(/sign-in\?sso=expired$/);
      // No session; only the spent binder is cleared (decision D101).
      expect(String(reply.headers['set-cookie'] ?? '')).not.toContain('_refresh=');
    },
  },
  'GET /auth/v1/sso/:tenant/saml/metadata': {
    kind: 'not tenant data',
    run: async () => {
      // Public by design: the addresses the identity provider registers, built from the slug.
      const reply = await send(undefined, 'GET', `/auth/v1/sso/t-${a.tenantId}/saml/metadata`);
      expect(reply.body).toContain('EntityDescriptor');
      holdsNothingOfA({
        ...reply,
        body: reply.body.replaceAll(`t-${a.tenantId}`, 'slug'),
      } as Reply);
    },
  },
  'GET /v1/users/:id/second-factor': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/users/${id}/second-factor`), a.admin.id),
  },
  'POST /v1/users/:id/second-factor/reset': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere((id) => asB('POST', `/v1/users/${id}/second-factor/reset`), a.admin.id),
  },
  'GET /v1/billing': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/billing')),
  },
  'GET /v1/billing/invoices': {
    kind: 'own tenant',
    run: async () => {
      const reply = await asB('GET', '/v1/billing/invoices');
      holdsNothingOfA(reply);
      expect(reply.body).not.toContain(aInvoiceId);
    },
  },
  'GET /v1/billing/invoices/:id': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/billing/invoices/${id}`), aInvoiceId),
  },
  'GET /v1/billing/invoices/:id/pdf': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/billing/invoices/${id}/pdf`), aInvoiceId),
  },
  'PUT /v1/billing/account': {
    kind: 'write',
    run: async () => {
      const reply = await asB('PUT', '/v1/billing/account', {
        legalName: 'Another Company',
        address: 'Somewhere in Pune 411001',
        stateCode: '27',
        email: 'accounts@b.example',
      });
      expect(reply.statusCode).toBe(200);
      holdsNothingOfA(reply);
    },
  },
  'POST /v1/billing/mandate': {
    kind: 'write',
    run: async () => holdsNothingOfA(await asB('POST', '/v1/billing/mandate')),
  },
  'GET /v1/notifications': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/notifications')),
  },
  'POST /v1/notifications/read': {
    kind: 'write',
    run: async () => {
      // A's admin holds a notification: A's request waits for them.
      const [theirs] = await admin<{ id: string }>(
        'select id from cell.notifications where tenant_id = $1 limit 1',
        [a.tenantId],
      );
      expect(theirs).toBeDefined();
      const read = (id: string) => asB('POST', '/v1/notifications/read', { ids: [id] });
      const mine = await read(theirs!.id);
      expect(mine.statusCode).toBe(200);
      expect(mine.json()).toEqual((await read(newId())).json());
    },
  },
  'GET /v1/notification-prefs': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/notification-prefs')),
  },
  'PUT /v1/notification-prefs': {
    kind: 'write',
    run: async () => {
      expect((await asB('PUT', '/v1/notification-prefs', { muted: ['plan'] })).statusCode).toBe(
        200,
      );
    },
  },
  'PUT /v1/push-tokens': {
    kind: 'write',
    run: async () => {
      const token = `ExponentPushToken[${newId().slice(0, 22)}]`;
      expect((await asBPhone('PUT', '/v1/push-tokens', { token, locale: 'en' })).statusCode).toBe(
        204,
      );
    },
  },
  'GET /v1/performance': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('GET', `/v1/performance?period=${TARGET_MONTH}&userId=${id}`),
        a.member.id,
      ),
  },
  'GET /v1/performance/team': {
    kind: 'own tenant',
    run: async () =>
      holdsNothingOfA(await asB('GET', `/v1/performance/team?period=${TARGET_MONTH}`)),
  },
  'GET /v1/leaderboard': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', `/v1/leaderboard?period=${TARGET_MONTH}`)),
  },
  'GET /v1/account-plans': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('GET', `/v1/account-plans?accountId=${id}&period=${TARGET_MONTH}`),
        aAccountId,
      ),
  },
  'PUT /v1/account-plans': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('PUT', '/v1/account-plans', {
            accountId: id,
            period: TARGET_MONTH,
            values: { visits: '1' },
          }),
        aAccountId,
      ),
  },
  'GET /v1/catalogue': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/catalogue')),
  },
  'PUT /v1/items/:itemId': {
    kind: 'write',
    run: async () => {
      // IDs belong to a tenant: B's item with one of A's IDs is B's own, as with any new ID.
      // (Not A's item's ID, which later fixtures offer B as an item B doesn't have.)
      for (const id of [aPriceListId, newId()]) {
        const made = await asB('PUT', `/v1/items/${id}`, {
          code: `B-${id.slice(-8)}`,
          name: 'B item',
          productName: 'B product',
          categoryName: null,
          packLabel: null,
          hsn: null,
          taxRate: '5',
          mrp: null,
          baseUnit: 'piece',
          units: [],
          measureType: null,
          measurePerBaseUnit: null,
        });
        expect(made.statusCode).toBe(201);
      }
    },
  },
  'GET /v1/price-lists': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/price-lists')),
  },
  'GET /v1/price-lists/:priceListId': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/price-lists/${id}`), aPriceListId),
  },
  'PUT /v1/price-lists/:priceListId': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('PUT', `/v1/price-lists/${newId()}`, {
            name: `B list ${newId()}`,
            scope: 'account',
            targets: [id],
            validFrom: '2026-01-01',
          }),
        aAccountId,
      ),
  },
  'GET /v1/price-lists/:priceListId/items': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/price-lists/${id}/items`), aPriceListId),
  },
  'PUT /v1/price-lists/:priceListId/items': {
    kind: 'by ID',
    run: async () => {
      await sameAsNowhere(
        (id) =>
          asB('PUT', `/v1/price-lists/${id}/items`, { set: [], remove: [aItemId], version: 1 }),
        aPriceListId,
      );
      const listId = newId();
      const made = await asB('PUT', `/v1/price-lists/${listId}`, {
        name: `B list ${listId}`,
        scope: 'default',
        validFrom: '2026-01-01',
      });
      expect(made.statusCode).toBe(201);
      await sameAsNowhere(
        (id) =>
          asB('PUT', `/v1/price-lists/${listId}/items`, {
            set: [{ itemId: id, price: '1' }],
            version: 1,
          }),
        aItemId,
      );
    },
  },
  'POST /v1/orders': {
    kind: 'write',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', '/v1/orders', {
            id: newId(),
            accountId: id,
            lines: [
              {
                itemId: newId(),
                unitKey: 'piece',
                quantity: '1',
                quoted: {
                  listId: newId(),
                  price: '1',
                  discount: '0',
                  taxRate: '0',
                  factor: '1',
                },
              },
            ],
            placedAt: new Date().toISOString(),
          }),
        aAccountId,
      ),
  },
  'GET /v1/orders': {
    kind: 'own tenant',
    run: async () => {
      holdsNothingOfA(await asB('GET', '/v1/orders'));
      holdsNothingOfA(await asB('GET', `/v1/orders?accountId=${aAccountId}`));
      holdsNothingOfA(await asB('GET', `/v1/orders?cursor=${aOrderId}`));
    },
  },
  'GET /v1/orders/:id': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/orders/${id}`), aOrderId),
  },
  'POST /v1/orders/:id/decision': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('POST', `/v1/orders/${id}/decision`, { decision: 'accept', version: 1 }),
        aOrderId,
      ),
  },
  'POST /v1/orders/:id/line-decisions': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', `/v1/orders/${id}/line-decisions`, {
            lines: [{ lineId: newId(), decision: 'accepted' }],
            version: 1,
          }),
        aOrderId,
      ),
  },
  'POST /v1/orders/:id/fulfilment': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', `/v1/orders/${id}/fulfilment`, {
            action: 'cancel',
            note: 'Not wanted',
            version: 1,
          }),
        aOrderId,
      ),
  },
  'POST /v1/finance-snapshots': {
    kind: 'write',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', '/v1/finance-snapshots', {
            id: newId(),
            accountId: id,
            asOf: '2026-09-30',
            outstanding: '10',
            source: 'B books',
          }),
        aAccountId,
      ),
  },
  'POST /v1/ledger-entries': {
    kind: 'write',
    run: async () => {
      await sameAsNowhere(
        (id) =>
          asB('POST', '/v1/ledger-entries', {
            entries: [
              {
                id: newId(),
                accountId: id,
                date: '2026-09-30',
                reference: `B-${newId()}`,
                debit: '1',
              },
            ],
          }),
        aAccountId,
      );
      // A's reference is B's to use: references belong to a tenant.
      const own = await asB('POST', '/v1/ledger-entries', {
        entries: [
          {
            id: newId(),
            accountId: bAccountId,
            date: '2026-09-30',
            reference: 'A-INV-1',
            debit: '2',
          },
        ],
      });
      expect(own.json()).toEqual({ created: 1, unchanged: 0 });
    },
  },
  'GET /v1/calendars': {
    kind: 'own tenant',
    run: async () => {
      const calendars = await asB('GET', '/v1/calendars');
      expect(calendars.statusCode).toBe(200);
      holdsNothingOfA(calendars);
    },
  },
  'PUT /v1/calendars/:key/holidays/:date': {
    kind: 'write',
    run: async () => {
      // Keys belong to a tenant: B's standard calendar is B's own, on A's holiday too.
      const put = await asB('PUT', `/v1/calendars/standard/holidays/${YESTERDAY()}`, {
        name: `${b.word} festival`,
      });
      expect(put.statusCode, put.body).toBe(200);
      holdsNothingOfA(put);
    },
  },
  'PUT /v1/users/:id/calendar': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('PUT', `/v1/users/${id}/calendar`, { calendarKey: null }),
        a.member.id,
      ),
  },
  'POST /v1/regularisations': {
    kind: 'write',
    run: async () => {
      // IDs belong to a tenant: B's request with A's ID is B's own.
      const asked = await asBPhone('POST', '/v1/regularisations', {
        id: aRegularisationId,
        date: YESTERDAY(),
        status: 'half_day',
        reason: `${b.word} meeting`,
      });
      expect(asked.statusCode, asked.body).toBe(201);
      expect(asked.json()).toMatchObject({ userId: b.member.id, state: 'pending' });
    },
  },
  'GET /v1/leave-types': {
    kind: 'own tenant',
    run: async () => {
      const types = await asB('GET', '/v1/leave-types');
      expect(types.statusCode).toBe(200);
      holdsNothingOfA(types);
    },
  },
  'PUT /v1/leave-types': {
    kind: 'write',
    run: async () => {
      // Keys belong to a tenant: B's study leave is B's own beside A's.
      const own = (await asB('GET', '/v1/leave-types')).json().items;
      const put = await asB('PUT', '/v1/leave-types', {
        items: [
          ...own.filter((type: { key: string }) => type.key !== 'study'),
          {
            key: 'study',
            name: named(`${b.word} study leave`),
            paid: false,
            annualQuota: 2,
            quotaYear: 'calendar',
            halfDayAllowed: false,
          },
        ],
      });
      expect(put.statusCode, put.body).toBe(200);
      holdsNothingOfA(put);
    },
  },
  'POST /v1/leave-requests': {
    kind: 'write',
    run: async () => {
      // IDs belong to a tenant: B's request with A's ID is B's own.
      const asked = await asBPhone('POST', '/v1/leave-requests', {
        id: aLeaveRequestId,
        leaveType: 'unpaid',
        startDate: LEAVE_DAY,
        endDate: LEAVE_DAY,
      });
      expect(asked.statusCode, asked.body).toBe(201);
      expect(asked.json()).toMatchObject({ userId: b.member.id, leaveType: 'unpaid' });
    },
  },
  'GET /v1/leave-requests': {
    kind: 'by ID',
    run: async () => {
      const own = await asB('GET', `/v1/leave-requests?year=${LEAVE_DAY.slice(0, 4)}`);
      expect(own.statusCode).toBe(200);
      holdsNothingOfA(own);
      await sameAsNowhere(
        (id) => asB('GET', `/v1/leave-requests?userId=${id}&year=${LEAVE_DAY.slice(0, 4)}`),
        a.member.id,
      );
    },
  },
  'GET /v1/leave-balances': {
    kind: 'by ID',
    run: async () => {
      const own = await asB('GET', `/v1/leave-balances?on=${LEAVE_DAY}`);
      expect(own.statusCode).toBe(200);
      holdsNothingOfA(own);
      await sameAsNowhere((id) => asB('GET', `/v1/leave-balances?userId=${id}`), a.member.id);
    },
  },
  'GET /v1/whatsapp-consent': {
    kind: 'own tenant',
    run: async () => {
      const consent = await asB('GET', '/v1/whatsapp-consent');
      expect(consent.statusCode).toBe(200);
      holdsNothingOfA(consent);
    },
  },
  'PUT /v1/whatsapp-consent': {
    kind: 'write',
    run: async () => {
      // A person's answer is their own: B's changes nothing of A's.
      const answered = await asB('PUT', '/v1/whatsapp-consent', { optedIn: true, version: 1 });
      expect(answered.statusCode, answered.body).toBe(200);
      holdsNothingOfA(answered);
    },
  },
  'GET /v1/expense-policies': {
    kind: 'own tenant',
    run: async () => {
      const policies = await asB('GET', '/v1/expense-policies');
      expect(policies.statusCode).toBe(200);
      holdsNothingOfA(policies);
    },
  },
  'PUT /v1/expense-policies': {
    kind: 'write',
    run: async () => {
      // Keys belong to a tenant: B's meals policy is B's own beside A's.
      const put = await asB('PUT', '/v1/expense-policies', {
        items: [
          {
            key: 'meals',
            name: named(`${b.word} meals`),
            category: 'other',
            calculation: 'actual',
          },
        ],
      });
      expect(put.statusCode, put.body).toBe(200);
      holdsNothingOfA(put);
    },
  },
  'POST /v1/expense-claims': {
    kind: 'write',
    run: async () => {
      const policy = await asB('PUT', '/v1/expense-policies', {
        items: [
          {
            key: 'meals',
            name: named(`${b.word} meals`),
            category: 'other',
            calculation: 'actual',
          },
        ],
      });
      expect(policy.statusCode, policy.body).toBe(200);
      // IDs belong to a tenant: B's claim with A's ID is B's own.
      const claimed = await asBPhone('POST', '/v1/expense-claims', {
        id: aClaimId,
        policy: 'meals',
        expenseDate: YESTERDAY(),
        description: `${b.word} lunch`,
        billAmount: '90',
      });
      expect(claimed.statusCode, claimed.body).toBe(201);
      expect(claimed.json()).toMatchObject({ userId: b.member.id, amount: '90.00' });
    },
  },
  'GET /v1/expense-claims': {
    kind: 'by ID',
    run: async () => {
      const own = await asB('GET', '/v1/expense-claims');
      expect(own.statusCode).toBe(200);
      holdsNothingOfA(own);
      await sameAsNowhere((id) => asB('GET', `/v1/expense-claims?userId=${id}`), a.member.id);
    },
  },
  'POST /v1/expense-claims/:id/receipts': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asBPhone('POST', `/v1/expense-claims/${id}/receipts`, { mediaIds: [newId()] }),
        aOtherClaimId,
      ),
  },
  'POST /v1/expense-claims/:id/paid': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere((id) => asB('POST', `/v1/expense-claims/${id}/paid`, {}), aOtherClaimId),
  },
  'GET /v1/regularisations': {
    kind: 'by ID',
    run: async () => {
      const own = await asB('GET', `/v1/regularisations?period=${YESTERDAY().slice(0, 7)}`);
      expect(own.statusCode).toBe(200);
      holdsNothingOfA(own);
      await sameAsNowhere(
        (id) => asB('GET', `/v1/regularisations?userId=${id}&period=${YESTERDAY().slice(0, 7)}`),
        a.member.id,
      );
    },
  },
  'GET /v1/accounts/:id/finance': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/accounts/${id}/finance`), aAccountId),
  },
  'GET /v1/accounts/:id/statement': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/accounts/${id}/statement`), aAccountId),
  },
  'GET /v1/accounts/:id/prices': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/accounts/${id}/prices`), aAccountId),
  },
  'GET /v1/org-chart': {
    kind: 'own tenant',
    run: async () => {
      const top = await asB('GET', '/v1/org-chart');
      expect(top.statusCode).toBe(200);
      holdsNothingOfA(top);
      await sameAsNowhere((id) => asB('GET', `/v1/org-chart?managerId=${id}`), a.admin.id);
    },
  },
  'GET /v1/user-fields': {
    kind: 'own tenant',
    run: async () => {
      const fields = await asB('GET', '/v1/user-fields');
      expect(fields.body).toContain(`${b.word} zone`);
      holdsNothingOfA(fields);
    },
  },
  'PUT /v1/user-fields': {
    kind: 'write',
    run: async () => {
      const replaced = await asB('PUT', '/v1/user-fields', {
        fields: [
          { key: 'zone', type: 'short_text', label: named(`${b.word} zone`), required: false },
        ],
      });
      expect(replaced.statusCode).toBe(200);
      holdsNothingOfA(replaced);
    },
  },
  'POST /v1/users/:id/transfers': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) =>
          asB('POST', `/v1/users/${id}/transfers`, {
            effectiveDate: NEXT_MONTH,
            designation: 'executive',
          }),
        a.member.id,
      ),
  },
  'GET /v1/users/:id/transfers': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/users/${id}/transfers`), a.member.id),
  },
  'POST /v1/users/:id/transfers/:transferId/cancel': {
    kind: 'by ID',
    run: async () => {
      // A's transfer, through A's user or B's own: both answer as for a transfer nowhere.
      await sameAsNowhere(
        (id) => asB('POST', `/v1/users/${a.member.id}/transfers/${id}/cancel`),
        aTransferId,
      );
      await sameAsNowhere(
        (id) => asB('POST', `/v1/users/${b.member.id}/transfers/${id}/cancel`),
        aTransferId,
      );
    },
  },
  'GET /v1/users/:id/history': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/users/${id}/history`), a.member.id),
  },
  'POST /v1/devices/heartbeat': {
    kind: 'write',
    run: async () => {
      const { accessToken } = await world.signIn(b.member.phone, b.memberDevice);
      const beat = await send(accessToken, 'POST', '/v1/devices/heartbeat', {
        appVersion: '0.1.0',
        osVersion: '15',
        queue: { queued: 0, parked: 0, oldestQueuedAt: null },
        lastSyncAt: null,
      });
      expect(beat.statusCode).toBe(204);
    },
  },
  'GET /v1/audit': {
    kind: 'own tenant',
    run: async () => {
      holdsNothingOfA(await asB('GET', '/v1/audit'));
      holdsNothingOfA(await asB('GET', `/v1/audit?actorId=${a.admin.id}`));
      holdsNothingOfA(await asB('GET', `/v1/audit?targetId=${a.member.id}`));
    },
  },
};

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
  a = await tenant('Alpha Agencies', 'Alphastore');
  b = await tenant('Bravo Brands', 'Bravostall');
  bToken = (await world.signIn(b.admin.phone)).accessToken;
  bPhoneToken = (await world.signIn(b.member.phone, b.memberDevice)).accessToken;
  // A sync cursor of A's, made before A's rows are taken down, since signing in writes some.
  const aToken = (await world.signIn(a.admin.phone)).accessToken;
  aCursor = (await send(aToken, 'GET', '/v1/sync/pull?entities=users')).json().cursor;
  // An API client of A's (decision D94), which B must never reach or use.
  const made = (
    await send(aToken, 'POST', '/v1/api-clients', {
      id: newId(),
      name: 'A ERP',
      scopes: ['people:read'],
    })
  ).json();
  aApiClient = { id: made.client.id, clientId: made.client.clientId, secret: made.clientSecret };
  // A webhook of A's, with a message from its test; nothing listens at the address.
  aWebhookId = newId();
  const hooked = await send(aToken, 'POST', '/v1/webhooks', {
    id: aWebhookId,
    url: NOWHERE_HOOK,
    events: ['user.created'],
  });
  expect(hooked.statusCode, hooked.body).toBe(201);
  aWebhookMessageId = (await send(aToken, 'POST', `/v1/webhooks/${aWebhookId}/test`)).json()
    .messageId;
  aDataExportId = newId();
  const exported = await send(aToken, 'POST', '/v1/data-exports', { id: aDataExportId });
  expect(exported.statusCode, exported.body).toBe(201);
  aDataRequestId = newId();
  const requested = await send(aToken, 'POST', '/v1/data-requests', {
    id: aDataRequestId,
    userId: a.member.id,
    kind: 'access',
  });
  expect(requested.statusCode, requested.body).toBe(201);
  const transfer = await send(aToken, 'POST', `/v1/users/${a.member.id}/transfers`, {
    effectiveDate: NEXT_MONTH,
    designation: 'executive',
  });
  expect(transfer.statusCode).toBe(201);
  aTransferId = transfer.json().id;
  aTerritoryId = await world.territory(a.tenantId, 'A-ZONE');
  const started = await upload(aToken, 'users', 'Employee code,Name\nA-1,Alpha One');
  expect(started.statusCode).toBe(201);
  aImportId = started.json().id;
  aTypeId = (await send(aToken, 'GET', '/v1/account-types')).json().items[0].id;
  aAccountId = newId();
  const account = await send(aToken, 'POST', '/v1/accounts', {
    id: aAccountId,
    type: 'customer',
    code: 'A-SHOP',
    name: `${a.word} shop`,
    territoryId: aTerritoryId,
    slots: { manager: a.member.id },
  });
  expect(account.statusCode).toBe(201);
  aItemId = newId();
  const madeItem = await send(aToken, 'PUT', `/v1/items/${aItemId}`, {
    code: 'A-ITEM',
    name: `${a.word} item`,
    productName: `${a.word} product`,
    categoryName: null,
    packLabel: null,
    hsn: null,
    taxRate: '18',
    mrp: null,
    baseUnit: 'piece',
    units: [],
    measureType: null,
    measurePerBaseUnit: null,
  });
  expect(madeItem.statusCode).toBe(201);
  aPriceListId = newId();
  const madeList = await send(aToken, 'PUT', `/v1/price-lists/${aPriceListId}`, {
    name: `${a.word} prices`,
    scope: 'account',
    targets: [aAccountId],
    validFrom: '2026-01-01',
  });
  expect(madeList.statusCode).toBe(201);
  const priced = await send(aToken, 'PUT', `/v1/price-lists/${aPriceListId}/items`, {
    set: [{ itemId: aItemId, price: '100' }],
    version: 1,
  });
  expect(priced.statusCode).toBe(200);
  aOrderId = newId();
  const ordered = await send(aToken, 'POST', '/v1/orders', {
    id: aOrderId,
    accountId: aAccountId,
    lines: [
      {
        itemId: aItemId,
        unitKey: 'piece',
        quantity: '2',
        quoted: {
          listId: aPriceListId,
          price: '100.00',
          discount: '0',
          taxRate: '18',
          factor: '1',
        },
      },
    ],
    note: `${a.word} order`,
    placedAt: new Date().toISOString(),
  });
  expect(ordered.statusCode, ordered.body).toBe(201);
  const snapshotted = await send(aToken, 'POST', '/v1/finance-snapshots', {
    id: newId(),
    accountId: aAccountId,
    asOf: '2026-09-30',
    outstanding: '1000',
    source: `${a.word} books`,
  });
  expect(snapshotted.statusCode, snapshotted.body).toBe(201);
  const posted = await send(aToken, 'POST', '/v1/ledger-entries', {
    entries: [
      {
        id: newId(),
        accountId: aAccountId,
        date: '2026-09-30',
        reference: 'A-INV-1',
        debit: '1000',
      },
    ],
  });
  expect(posted.statusCode, posted.body).toBe(200);
  const holiday = await send(aToken, 'PUT', `/v1/calendars/standard/holidays/${YESTERDAY()}`, {
    name: `${a.word} festival`,
  });
  expect(holiday.statusCode, holiday.body).toBe(200);
  aContactId = newId();
  await send(aToken, 'POST', `/v1/accounts/${aAccountId}/contacts`, {
    id: aContactId,
    name: 'A contact',
  });
  // A's member stands at the shop; A's admin, their manager, is asked to decide.
  const memberToken = (await world.signIn(a.member.phone, a.memberDevice)).accessToken;
  const proposal = await send(
    memberToken,
    'POST',
    `/v1/accounts/${aAccountId}/location-proposals`,
    {
      id: newId(),
      lat: 12.9716,
      lng: 77.5946,
      accuracy: 15,
      capturedAt: new Date().toISOString(),
      proposedAt: new Date().toISOString(),
    },
  );
  expect(proposal.statusCode).toBe(201);
  aApprovalId = proposal.json().approvalId;
  // A's member asks to count a day as present.
  aRegularisationId = newId();
  const fixed = await send(memberToken, 'POST', '/v1/regularisations', {
    id: aRegularisationId,
    date: YESTERDAY(),
    status: 'present',
    reason: `${a.word} meeting at the depot`,
  });
  expect(fixed.statusCode, fixed.body).toBe(201);
  // A's own leave type, and its member asks for a day of leave next month.
  const leaveTypes = (await send(aToken, 'GET', '/v1/leave-types')).json().items;
  const study = await send(aToken, 'PUT', '/v1/leave-types', {
    items: [
      ...leaveTypes,
      {
        key: 'study',
        name: named(`${a.word} study leave`),
        paid: true,
        annualQuota: 5,
        quotaYear: 'calendar',
        halfDayAllowed: false,
      },
    ],
  });
  expect(study.statusCode, study.body).toBe(200);
  aLeaveRequestId = newId();
  const leave = await send(memberToken, 'POST', '/v1/leave-requests', {
    id: aLeaveRequestId,
    leaveType: 'study',
    startDate: LEAVE_DAY,
    endDate: LEAVE_DAY,
    reason: `${a.word} exam`,
  });
  expect(leave.statusCode, leave.body).toBe(201);
  // A's own expense policy, and its member's claim under it.
  const policy = await send(aToken, 'PUT', '/v1/expense-policies', {
    items: [
      {
        key: 'meals',
        name: named(`${a.word} meals`),
        category: 'other',
        calculation: 'actual',
      },
    ],
  });
  expect(policy.statusCode, policy.body).toBe(200);
  aClaimId = newId();
  const claimed = await send(memberToken, 'POST', '/v1/expense-claims', {
    id: aClaimId,
    policy: 'meals',
    expenseDate: YESTERDAY(),
    description: `${a.word} lunch`,
    billAmount: '120',
  });
  expect(claimed.statusCode, claimed.body).toBe(201);
  aOtherClaimId = newId();
  const other = await send(memberToken, 'POST', '/v1/expense-claims', {
    id: aOtherClaimId,
    policy: 'meals',
    expenseDate: YESTERDAY(),
    description: `${a.word} dinner`,
    billAmount: '80',
  });
  expect(other.statusCode, other.body).toBe(201);
  aFormId = (await send(aToken, 'GET', '/v1/forms')).json().items[0].id;
  // A's member on shift: punched in an hour ago, with a point, and tracking paused.
  aShiftId = newId();
  const shift = await send(memberToken, 'POST', '/v1/shifts', {
    ...FIX,
    id: aShiftId,
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    consentVersion: '1',
  });
  expect(shift.statusCode).toBe(201);
  const points = await send(memberToken, 'POST', '/v1/locations/batch', {
    points: [
      {
        id: newId(),
        shiftId: aShiftId,
        capturedAt: new Date(Date.now() - 1_800_000).toISOString(),
        location: FIX.location,
        accuracy: 12,
        mocked: false,
        source: 'background',
      },
    ],
  });
  expect(points.json().accepted).toHaveLength(1);
  aPauseId = newId();
  const paused = await send(memberToken, 'POST', `/v1/shifts/${aShiftId}/pauses`, {
    id: aPauseId,
    pausedAt: new Date().toISOString(),
    reason: 'Lunch',
  });
  expect(paused.statusCode).toBe(201);
  // A's member visits A's shop and fills a form of A's own there.
  aVisitId = newId();
  const visit = await send(memberToken, 'POST', '/v1/visits', {
    id: aVisitId,
    accountId: aAccountId,
    checkedInAt: new Date().toISOString(),
    fix: { ...FIX, capturedAt: new Date().toISOString() },
  });
  expect(visit.statusCode).toBe(201);
  const note = await send(aToken, 'POST', '/v1/forms', {
    definition: {
      key: 'zz_note',
      name: noun(`${a.word} note`),
      icon: 'notebook-pen',
      accountLink: { mode: 'optional', accountTypes: ['customer'] },
      fields: [{ key: 'note', type: 'short_text', label: named('Note'), required: true }],
    },
  });
  expect(note.statusCode).toBe(201);
  aSubmissionId = newId();
  const submitted = await send(memberToken, 'POST', '/v1/submissions', {
    id: aSubmissionId,
    form: { key: 'zz_note', version: 1 },
    visitId: aVisitId,
    capturedAt: new Date().toISOString(),
    fix: { ...FIX, capturedAt: new Date().toISOString() },
    values: { note: `${a.word} looked fine` },
  });
  expect(submitted.statusCode).toBe(201);
  // An invoice of A's, on the example seller (decision D90).
  await app.get(BillingSettings).ensureExample();
  await app.get(ExamplePlans).ensure();
  await app.get(TenantBillingService).setAccount(null, a.tenantId, {
    legalName: `${a.word} Private Limited`,
    gstin: null,
    address: 'Plot 9, MIDC Industrial Area, Nashik 422010',
    stateCode: '27',
    email: 'accounts@a.example',
    language: 'en',
  });
  const today = todayIn('Asia/Kolkata', new Date());
  aInvoiceId = await app.get(DirectoryDatabase).db.transaction(async (tx) => {
    const [plan] = await tx.select({ id: plans.id }).from(plans).limit(1);
    const subscriptionId = newId();
    await tx.insert(subscriptions).values({
      id: subscriptionId,
      tenantId: a.tenantId,
      planId: plan!.id,
      cycle: 'month',
      startedOn: today,
    });
    const issued = await app.get(InvoicesService).issue(tx, {
      tenantId: a.tenantId,
      subscriptionId,
      kind: 'monthly',
      period: { from: today, to: today },
      lines: [
        { description: `${a.word} seats`, quantity: '1.0000', rate: '100.00', amount: '100.00' },
      ],
      issuedOn: today,
    });
    return issued!.id;
  });
  // Vendor support asks to enter A (decision D93).
  const staffId = newId();
  await app.get(StaffService).invite(
    {
      id: staffId,
      email: `support-${staffId.slice(-8)}@vendor.example`,
      name: 'Support',
      role: 'support',
    },
    null,
  );
  // An announcement for A alone, naming A, which B must never see (decision D93).
  await app.get(AnnouncementsService).create(
    { staffId, role: 'platform_admin', permissions: new Set(['platform.tenant.manage']) },
    {
      id: newId(),
      title: { en: `For ${a.word}`, hi: `For ${a.word}` },
      body: { en: `Only ${a.word} sees this`, hi: `Only ${a.word} sees this` },
      tone: 'info',
      surfaces: ['web', 'mobile'],
      tenantIds: [a.tenantId],
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  );
  aSupportGrantId = (
    await app.get(SupportService).request(
      { staffId, role: 'support', permissions: new Set(['platform.support.request']) },
      {
        tenantId: a.tenantId,
        reason: 'Checking the contract test',
        scope: 'read',
        hours: 1,
        emergency: false,
      },
    )
  ).id;
  // A route and a planned visit for A's member.
  aExportId = newId();
  const asked = await send(aToken, 'POST', '/v1/exports', {
    id: aExportId,
    report: 'attendance_register',
    filters: { period: new Date().toISOString().slice(0, 7) },
    format: 'csv',
  });
  expect(asked.statusCode).toBe(201);
  aRouteId = newId();
  const route = await send(aToken, 'POST', '/v1/routes', {
    id: aRouteId,
    userId: a.member.id,
    name: `${a.word} round`,
    recurrence: { kind: 'weekdays', days: [1, 4] },
    accountIds: [aAccountId],
  });
  expect(route.statusCode).toBe(201);
  aPlanItemId = newId();
  const planned = await send(aToken, 'POST', '/v1/plan-items', {
    id: aPlanItemId,
    userId: a.member.id,
    accountId: aAccountId,
    date: NEXT_MONTH,
    purpose: `${a.word} check`,
  });
  expect(planned.statusCode).toBe(201);
  // Targets and an account plan of A's.
  const targets = await send(aToken, 'PUT', '/v1/targets', {
    period: TARGET_MONTH,
    sets: [{ userId: a.member.id, values: { visits: '40' }, version: 0 }],
  });
  expect(targets.statusCode).toBe(200);
  const accountPlan = await send(aToken, 'PUT', '/v1/account-plans', {
    accountId: aAccountId,
    period: TARGET_MONTH,
    values: { order_value: '500000' },
  });
  expect(accountPlan.statusCode).toBe(200);
  // A photo of A's, uploaded and confirmed as a phone would.
  aPhotoId = newId();
  const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const presigned = await send(aToken, 'POST', '/v1/media/presign', {
    id: aPhotoId,
    kind: 'evidence',
    contentType: 'image/jpeg',
    size: photo.byteLength,
    sha256: createHash('sha256').update(photo).digest('hex'),
  });
  (app.get(ObjectStore) as MemoryObjectStore).receive(presigned.json().upload.url, photo);
  const confirmed = await send(aToken, 'POST', `/v1/media/${aPhotoId}/confirm`, {
    capturedAt: new Date().toISOString(),
    source: 'camera',
  });
  expect(confirmed.statusCode).toBe(200);
  bTerritoryId = await world.territory(b.tenantId, 'B-ZONE');
  bAccountId = newId();
  expect(
    (
      await send(bToken, 'POST', '/v1/accounts', {
        id: bAccountId,
        type: 'customer',
        code: 'B-SHOP',
        name: 'B shop',
        territoryId: bTerritoryId,
      })
    ).statusCode,
  ).toBe(201);
  // Notifications the seeding raised are delivered now, so no worker changes A's rows later.
  for (const tenantId of [a.tenantId, b.tenantId]) {
    const waiting = await admin<{ id: string }>(
      `select id from cell.notification_deliveries where tenant_id = $1 and status in ('queued', 'held')`,
      [tenantId],
    );
    for (const { id } of waiting) await app.get(NotificationDelivery).deliver(tenantId, id);
  }
  aRows = await rowsOf(a.tenantId);
  const theirs = idsIn(await rowsOf(b.tenantId));
  aIds = [...idsIn(aRows)].filter((id) => !theirs.has(id));
});

afterAll(async () => {
  await world.end();
  await app.close();
});

describe('the cross-tenant contract test (spec 14.4)', () => {
  it('has a fixture for every route, and none for a route that is gone', () => {
    const keys = routes.map((route) => route.key);
    expect(keys.filter((key) => !(key in FIXTURES))).toEqual([]);
    expect(Object.keys(FIXTURES).filter((key) => !keys.includes(key))).toEqual([]);
  });

  it('covers every route the running app serves', () => {
    const served = new Set<string>();
    for (const module of app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const prototype = Object.getPrototypeOf(wrapper.instance) as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value;
          if (name === 'constructor' || typeof handler !== 'function') continue;
          if (Reflect.getMetadata('path', handler) !== undefined) {
            served.add(`${wrapper.name}.${name}`);
          }
        }
      }
    }
    expect([...served].sort()).toEqual(routes.map((route) => route.handler).sort());
  });

  it('starts from two tenants that each have people, roles, words and settings of their own', () => {
    expect(aIds.length).toBeGreaterThan(10);
    expect(Object.values(aRows).flat().length).toBeGreaterThan(20);
  });

  for (const route of routes) {
    const fixture = FIXTURES[route.key];
    it.runIf(fixture)(`${route.key} (${fixture?.kind}) leaves tenant A untouched`, async () => {
      await fixture!.run();
      expect(await rowsOf(a.tenantId)).toEqual(aRows);
    });
  }
});

describe('the checks themselves', () => {
  // Tenant A's own admin reaches A, so every check must trip; a check that can't fail proves nothing.
  const aAdmin = async () => (await world.signIn(a.admin.phone)).accessToken;

  it('see A in a read', async () => {
    const read = await send(await aAdmin(), 'GET', '/v1/users');
    expect(() => holdsNothingOfA(read)).toThrow();
  });

  it('see an ID of A that answers', async () => {
    const token = await aAdmin();
    await expect(
      sameAsNowhere((id) => send(token, 'GET', `/v1/users/${id}`), a.member.id),
    ).rejects.toThrow();
  });

  it('see a write to A', async () => {
    await send(await aAdmin(), 'PATCH', `/v1/users/${a.member.id}`, { name: 'Changed By A' });
    expect(await rowsOf(a.tenantId)).not.toEqual(aRows);
    aRows = await rowsOf(a.tenantId);
  });
});
