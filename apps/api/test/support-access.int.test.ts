import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StaffService } from '../src/modules/console/staff.service';
import { totpAt, totpStep } from '../src/platform/totp';
import { newAddress, newPhone, startApp, testConfig, World } from './support';

/**
 * Support access (module M22, decision D93): vendor staff ask to enter a tenant; its admin
 * approves for a fixed time, narrower if they like, or declines; an emergency is approved by a
 * second vendor admin and reads only. Under a grant, staff open the portal as vendor support,
 * whose every action is audited with the grant, and whose access ends with it.
 */

const WEB_URL = 'http://127.0.0.1:5173';
let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp(testConfig({ WEB_URL }));
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

function call(method: 'GET' | 'POST' | 'PUT', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

/** A vendor staff member signed in to the console, with their role. */
async function staffToken(role: 'support' | 'platform_admin'): Promise<string> {
  const email = `${role}-${newId().slice(-8)}@vendor.example`;
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url, payload, remoteAddress: newAddress() });
  const { setupUrl } = await app
    .get(StaffService)
    .invite({ id: newId(), email, name: `Staff ${role}`, role }, null);
  const token = setupUrl.split('#')[1]!;
  const { secret } = (
    await post('/platform/v1/setup', { token, password: 'a long staff password' })
  ).json();
  await post('/platform/v1/setup/confirm', { token, code: totpAt(secret, totpStep()) });
  const signedIn = await post('/platform/v1/session', {
    email,
    password: 'a long staff password',
    code: totpAt(secret, totpStep() + 1),
  });
  return signedIn.json().accessToken;
}

/** A tenant with its admin signed in. */
async function organisation() {
  const tenantId = await world.tenant('Support Org');
  const adminPhone = newPhone();
  const adminUser = await world.user(tenantId, {
    phone: adminPhone,
    designation: 'head',
    role: 'tenant_admin',
  });
  const admin = (await world.signIn(adminPhone)).accessToken;
  return { tenantId, admin, adminId: adminUser.id };
}

/** Follows an entry link as a browser would: the code becomes the portal's cookie. */
async function enter(staff: string, grantId: string) {
  const link = await call('POST', `/platform/v1/support-grants/${grantId}/enter`, staff);
  expect(link.statusCode, link.body).toBe(200);
  const url = new URL(link.json().url);
  expect(`${url.origin}${url.pathname}`).toBe(`${WEB_URL}/auth/v1/support/enter`);
  const landed = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
  return { landed, path: `${url.pathname}${url.search}` };
}

/** Restores the portal's session from its cookie, as a reload does. */
async function restore(cookie: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/v1/token/refresh',
    headers: { 'x-client': 'web', cookie },
    remoteAddress: newAddress(),
    payload: {},
  });
}

const cookieOf = (response: { headers: Record<string, unknown> }) =>
  String(response.headers['set-cookie']).split(';')[0]!;

describe('support access (M22, D93)', () => {
  it('asks the admin, enters under a read grant as vendor support, and ends with it', async () => {
    const org = await organisation();
    const staff = await staffToken('support');
    const asked = await call('POST', '/platform/v1/support-grants', staff, {
      tenantId: org.tenantId,
      reason: 'Checking why the visit report is empty',
      scope: 'read',
      hours: 4,
    });
    expect(asked.statusCode, asked.body).toBe(201);
    const grant = asked.json();
    expect(grant).toMatchObject({ status: 'requested', scope: 'read', hours: 4 });

    // The admin hears of it, and the audit log keeps it, marked with the grant.
    const inbox = (await call('GET', '/v1/notifications', org.admin)).json().items;
    expect(inbox).toContainEqual(
      expect.objectContaining({
        event: 'support.requested',
        link: '/settings/support',
        values: expect.objectContaining({ duration_en: '4 hours', access_en: 'see' }),
      }),
    );
    const audit = (await call('GET', '/v1/audit?action=support.requested', org.admin)).json();
    expect(audit.items[0]).toMatchObject({
      actor: { kind: 'platform' },
      supportGrantId: grant.id,
    });

    // Nothing opens before the admin approves; asking twice is refused.
    expect(
      (await call('POST', `/platform/v1/support-grants/${grant.id}/enter`, staff)).json().error
        .code,
    ).toBe('CONFLICT');
    const twice = await call('POST', '/platform/v1/support-grants', staff, {
      tenantId: org.tenantId,
      reason: 'Asking a second time for the same',
    });
    expect(twice.json().error.code).toBe('CONFLICT');

    // The admin can shorten it, never lengthen it.
    const longer = await call('POST', `/v1/support-grants/${grant.id}/decision`, org.admin, {
      approve: true,
      hours: 6,
    });
    expect(longer.json().error.details).toEqual([{ path: 'hours', issue: 'Approve 1 to 4 hours' }]);
    const approved = await call('POST', `/v1/support-grants/${grant.id}/decision`, org.admin, {
      approve: true,
      hours: 2,
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({
      status: 'active',
      grantedScope: 'read',
      hours: 2,
      approvedBy: { kind: 'user' },
    });

    const { landed, path } = await enter(staff, grant.id);
    expect(landed.statusCode, landed.body).toBe(302);
    expect(landed.headers.location).toBe(`${WEB_URL}/`);
    const cookie = cookieOf(landed);
    // The link works once.
    const again = await app.inject({ method: 'GET', url: path });
    expect(again.headers.location).toBe(`${WEB_URL}/sign-in?support=expired`);

    const restored = await restore(cookie);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().tenant.id).toBe(org.tenantId);
    const support = restored.json().session.accessToken as string;

    const me = (await call('GET', '/v1/me', support)).json();
    expect(me).toMatchObject({
      name: 'Staff support',
      role: 'vendor_support',
      scope: 'tenant',
      support: { grantId: grant.id, staffName: 'Staff support', scope: 'read' },
    });
    expect(me.permissions).not.toContain('billing.manage');
    // Support reads everything, settings included, but changes nothing and never sees billing.
    expect((await call('GET', '/v1/users', support)).statusCode).toBe(200);
    expect((await call('GET', '/v1/support-grants', support)).statusCode).toBe(200);
    expect((await call('GET', '/v1/billing', support)).json().error.code).toBe('FORBIDDEN');
    const write = await call('POST', '/v1/designations', support, {
      key: 'support_made',
      name: { en: { one: 'Lead', other: 'Leads' }, hi: { one: 'लीड', other: 'लीड' } },
      level: 3,
      defaultRole: 'field_user',
      canHaveReports: false,
    });
    expect(write.json().error.code).toBe('SUPPORT_READ_ONLY');

    // The admin ends it: the session ends at once, and so does its cookie.
    const ended = await call('POST', `/v1/support-grants/${grant.id}/end`, org.admin);
    expect(ended.json()).toMatchObject({ status: 'ended', closedBy: { kind: 'user' } });
    expect((await call('GET', '/v1/me', support)).json().error.code).toBe('SESSION_REVOKED');
    expect((await restore(cookie)).json().error.code).toBe('SESSION_REVOKED');
  });

  it('audits what support changes under a write grant, and never lets it decide its own access', async () => {
    const org = await organisation();
    const staff = await staffToken('support');
    const grant = (
      await call('POST', '/platform/v1/support-grants', staff, {
        tenantId: org.tenantId,
        reason: 'Setting up designations with the customer',
        scope: 'write',
        hours: 1,
      })
    ).json();
    await call('POST', `/v1/support-grants/${grant.id}/decision`, org.admin, { approve: true });
    const support = (await restore(cookieOf((await enter(staff, grant.id)).landed))).json().session
      .accessToken as string;

    const made = await call('POST', '/v1/designations', support, {
      key: 'support_made',
      name: { en: { one: 'Lead', other: 'Leads' }, hi: { one: 'लीड', other: 'लीड' } },
      level: 3,
      defaultRole: 'field_user',
      canHaveReports: false,
    });
    expect(made.statusCode, made.body).toBe(201);
    const audit = (await call('GET', '/v1/audit?action=designation.created', org.admin)).json();
    expect(audit.items[0]).toMatchObject({
      actor: { kind: 'platform' },
      supportGrantId: grant.id,
    });
    // The admin sees what vendor staff did with the grant; their own decision is theirs.
    const done = (await call('GET', `/v1/audit?supportGrantId=${grant.id}`, org.admin)).json();
    expect(done.items.map((item: { action: string }) => item.action)).toEqual([
      'designation.created',
      'support.requested',
    ]);

    expect(
      (await call('POST', `/v1/support-grants/${grant.id}/end`, support)).json().error.code,
    ).toBe('FORBIDDEN');
    // Staff end it themselves; the admin's audit log says so.
    const ended = await call('POST', `/platform/v1/support-grants/${grant.id}/end`, staff);
    expect(ended.json()).toMatchObject({ status: 'ended', closedBy: { kind: 'staff' } });
    const endedEntry = (await call('GET', '/v1/audit?action=support.ended', org.admin)).json();
    expect(endedEntry.items[0]).toMatchObject({ supportGrantId: grant.id });
  });

  it('lets a second vendor admin approve emergency access, which reads only, for two hours at most', async () => {
    const org = await organisation();
    const staff = await staffToken('support');
    const admin = await staffToken('platform_admin');
    const ask = (body: object) =>
      call('POST', '/platform/v1/support-grants', staff, {
        tenantId: org.tenantId,
        reason: 'Orders are failing for everyone',
        emergency: true,
        ...body,
      });
    expect((await ask({ scope: 'write', hours: 1 })).json().error.details).toEqual([
      { path: 'scope', issue: 'Emergency access reads only' },
    ]);
    expect((await ask({ hours: 3 })).json().error.details).toEqual([
      { path: 'hours', issue: 'Ask for 1 to 2 hours' },
    ]);
    const grant = (await ask({ hours: 2 })).json();
    // Nobody at the tenant is asked; support staff can't approve it themselves.
    expect(
      (await call('POST', `/platform/v1/support-grants/${grant.id}/approve`, staff)).json().error
        .code,
    ).toBe('FORBIDDEN');

    const approved = await call('POST', `/platform/v1/support-grants/${grant.id}/approve`, admin);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({
      status: 'active',
      grantedScope: 'read',
      approvedBy: { kind: 'staff', name: 'Staff platform_admin' },
    });
    const inbox = (await call('GET', '/v1/notifications', org.admin)).json().items;
    expect(inbox).toContainEqual(expect.objectContaining({ event: 'support.emergency' }));
    expect(inbox).not.toContainEqual(expect.objectContaining({ event: 'support.requested' }));

    // The tenant's admin can end it.
    const ended = await call('POST', `/v1/support-grants/${grant.id}/end`, org.admin);
    expect(ended.json().status).toBe('ended');
  });

  it('declines a request, and shows the tenant only its own grants', async () => {
    const org = await organisation();
    const other = await organisation();
    const staff = await staffToken('support');
    const grant = (
      await call('POST', '/platform/v1/support-grants', staff, {
        tenantId: org.tenantId,
        reason: 'Looking at the import that failed',
      })
    ).json();
    expect(
      (
        await call('POST', `/v1/support-grants/${grant.id}/decision`, other.admin, {
          approve: true,
        })
      ).json().error.code,
    ).toBe('NOT_FOUND');
    expect((await call('GET', '/v1/support-grants', other.admin)).json().items).toEqual([]);

    const declined = await call('POST', `/v1/support-grants/${grant.id}/decision`, org.admin, {
      approve: false,
    });
    expect(declined.json()).toMatchObject({ status: 'declined', closedBy: { kind: 'user' } });
    expect(
      (await call('POST', `/platform/v1/support-grants/${grant.id}/enter`, staff)).json().error
        .code,
    ).toBe('CONFLICT');
    const mine = await call('GET', '/platform/v1/support-grants?mine=true', staff);
    expect(mine.json().items.map((item: { id: string }) => item.id)).toContain(grant.id);
  });
});
