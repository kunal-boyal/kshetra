import { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffService } from '../src/modules/console/staff.service';
import { AuditLog, SYSTEM_ACTOR } from '../src/platform/audit';
import { Database } from '../src/platform/database';
import { newAddress, newDevice, newPhone, startApp, testConfig, World } from './support';

/**
 * Security logging (ASVS V16, decision D101): who asked on every access line, a line for every
 * refusal by a security control, sign-ins with their factors and failures with whom they were for
 * (masked), reused refresh tokens, and each committed audit entry mirrored outside the database.
 */

let app: NestFastifyApplication;
let world: World;
/** Every object logged, with the logger's context, as the JSON lines would carry them. */
let lines: { context: string; line: Record<string, unknown> }[] = [];

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(function (this: Logger, message: unknown) {
    if (message && typeof message === 'object') {
      lines.push({
        context: (this as unknown as { context?: string }).context ?? '',
        line: message as Record<string, unknown>,
      });
    }
  });
});

beforeEach(() => {
  lines = [];
});

afterAll(async () => {
  vi.restoreAllMocks();
  await world.end();
  await app.close();
});

const security = () => lines.filter((each) => each.context === 'Security').map((each) => each.line);

async function organisation(name: string) {
  const tenantId = await world.tenant(name);
  const adminPhone = newPhone();
  const admin = await world.user(tenantId, {
    phone: adminPhone,
    designation: 'head',
    role: 'tenant_admin',
  });
  const managerPhone = newPhone();
  const manager = await world.user(tenantId, { phone: managerPhone });
  return { tenantId, admin, adminPhone, manager, managerPhone };
}

describe('security logging (decision D101)', () => {
  it('names the tenant, caller and address on access lines, and logs every refusal', async () => {
    const o = await organisation('Watched Co');
    const { accessToken } = await world.signIn(o.managerPhone);
    lines = [];
    const address = newAddress();
    const refused = await app.inject({
      method: 'GET',
      url: '/v1/api-clients',
      headers: { authorization: `Bearer ${accessToken}` },
      remoteAddress: address,
    });
    expect(refused.statusCode).toBe(403);
    const requestId = refused.headers['x-request-id'];

    const access = lines.find((each) => each.context === 'HTTP' && each.line.status === 403);
    expect(access?.line).toMatchObject({
      requestId,
      path: '/v1/api-clients',
      ip: address,
      tenantId: o.tenantId,
      actor: `user:${o.manager.id}`,
    });
    expect(security()).toContainEqual(
      expect.objectContaining({
        event: 'refused',
        code: 'FORBIDDEN',
        requestId,
        ip: address,
        path: 'GET /v1/api-clients',
        tenantId: o.tenantId,
        actor: `user:${o.manager.id}`,
      }),
    );
  });

  it('logs a wrong SMS code with the number masked, and a sign-in with its factors', async () => {
    const o = await organisation('Careful Logs Co');
    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/v1/otp/verify',
      payload: { phone: o.managerPhone, code: '000000' },
      remoteAddress: newAddress(),
    });
    expect(wrong.statusCode).toBe(400);
    const failed = security().find((line) => line.event === 'sign_in_failed');
    expect(failed).toMatchObject({ method: 'sms_code', reason: 'no_live_code' });
    expect(String(failed!.subject)).toMatch(/•/);
    expect(JSON.stringify(security())).not.toContain(o.managerPhone.slice(3));

    lines = [];
    await world.signIn(o.adminPhone);
    expect(security()).toContainEqual(
      expect.objectContaining({
        event: 'signed_in',
        tenantId: o.tenantId,
        actor: `user:${o.admin.id}`,
        method: 'sms_code',
        factors: ['sms_code', 'authenticator'],
      }),
    );
    // The cell's audit entry for it is mirrored too, without its values.
    expect(security()).toContainEqual(
      expect.objectContaining({
        event: 'audit',
        plane: 'cell',
        tenantId: o.tenantId,
        action: 'session.signed_in',
      }),
    );

    lines = [];
    await world.signIn(o.managerPhone, newDevice());
    expect(security()).toContainEqual(
      expect.objectContaining({
        event: 'signed_in',
        actor: `user:${o.manager.id}`,
        factors: ['sms_code', 'bound_device'],
      }),
    );
  });

  it('logs a refresh token presented twice', async () => {
    const o = await organisation('Copied Token Co');
    const { refreshToken } = await world.signIn(o.managerPhone, newDevice());
    const refresh = () =>
      app.inject({
        method: 'POST',
        url: '/auth/v1/token/refresh',
        payload: { refreshToken },
        remoteAddress: newAddress(),
      });
    expect((await refresh()).statusCode).toBe(200);
    lines = [];
    expect((await refresh()).json().error.code).toBe('SESSION_REVOKED');
    expect(security()).toContainEqual(
      expect.objectContaining({ event: 'session_reused', plane: 'directory' }),
    );
    expect(security()).toContainEqual(
      expect.objectContaining({ event: 'refused', code: 'SESSION_REVOKED' }),
    );
  });

  it('logs a staff member’s wrong password with the email masked', async () => {
    const email = `logged-${newId().slice(-8)}@vendor.example`;
    await app
      .get(StaffService)
      .invite({ id: newId(), email, name: 'Lata Menon', role: 'support' }, null);
    const reply = await app.inject({
      method: 'POST',
      url: '/platform/v1/session',
      payload: { email, password: 'not the password', code: '123456' },
      remoteAddress: newAddress(),
    });
    expect(reply.statusCode).toBe(401);
    expect(security()).toContainEqual(
      expect.objectContaining({
        event: 'sign_in_failed',
        method: 'password',
        subject: 'l…@vendor.example',
        reason: 'account_invited',
      }),
    );
    expect(JSON.stringify(security())).not.toContain(email);
  });

  it('mirrors an audit entry only once its change commits', async () => {
    const tenantId = await world.tenant('Rolled Back Co');
    lines = [];
    const record = (fail: boolean) =>
      app.get(Database).forTenant(tenantId, async (tx) => {
        await app.get(AuditLog).record(tx, tenantId, SYSTEM_ACTOR, {
          action: 'settings.updated',
          target: { type: 'tenant', id: tenantId },
          after: { theme: 'secret value' },
        });
        if (fail) throw new Error('rolled back');
      });
    await expect(record(true)).rejects.toThrow('rolled back');
    expect(security().filter((line) => line.event === 'audit')).toEqual([]);

    await record(false);
    const mirrored = security().filter((line) => line.event === 'audit');
    expect(mirrored).toEqual([
      {
        event: 'audit',
        plane: 'cell',
        tenantId,
        actor: 'system',
        action: 'settings.updated',
        target: `tenant:${tenantId}`,
      },
    ]);
    expect(JSON.stringify(mirrored)).not.toContain('secret value');
  });
});
