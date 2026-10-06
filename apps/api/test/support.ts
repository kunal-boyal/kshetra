import { createHash, randomBytes } from 'node:crypto';
import { CreateUserBody, type DeviceInfo, newId, type UserResult } from '@kshetra/shared';
import { loadTemplate } from '@kshetra/templates';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { expect, inject } from 'vitest';
import { createApp } from '../src/app';
import { type Config, loadConfig } from '../src/config';
import { MemoryOtpSender, OtpSender } from '../src/modules/directory/otp-sender';
import { OTP_LIMITS } from '../src/modules/directory/otp.service';
import { SYSTEM } from '../src/modules/iam/actor';
import { IamSetup } from '../src/modules/iam/setup.service';
import { UsersService } from '../src/modules/iam/users.service';
import { TenantConfigService } from '../src/modules/tenant-config/tenant-config.service';
import { TerritoriesService } from '../src/modules/territories/territories.service';
import { Database } from '../src/platform/database';
import { RedisClient } from '../src/platform/redis';

/** The API's settings for a test, pointed at the run's PostgreSQL and Redis. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  const urls = inject('databaseUrls');
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: urls.cellApp,
    DIRECTORY_DATABASE_URL: urls.directoryApp,
    REDIS_URL: inject('redisUrl'),
    OTP_PROVIDER: 'memory',
    OTP_PEPPER: 'a-test-pepper-of-16+',
    // Tests run the relay themselves, so nothing retries behind their backs.
    OUTBOX_RELAY: 'false',
    ...overrides,
  });
}

/** A started app that takes injected requests, with logging off. */
export async function startApp(config: Config = testConfig()): Promise<NestFastifyApplication> {
  const app = await createApp(config, false);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** A fresh Indian mobile number, so tests never share rate limits or identities. */
export function newPhone(): string {
  return `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

/** A fresh private address for a test's requests, for the same reason. */
export function newAddress(): string {
  const n = () => Math.floor(Math.random() * 250) + 1;
  return `10.${n()}.${n()}.${n()}`;
}

/** A phone as the mobile app describes it at sign-in, with a fresh device key. */
export function newDevice(model = 'Test phone'): DeviceInfo {
  return { key: randomBytes(32).toString('base64url'), platform: 'android', model };
}

/** Writes directory rows directly, as the directory's own role does. */
export class DirectoryFixtures {
  readonly client: pg.Client;

  private constructor(client: pg.Client) {
    this.client = client;
  }

  static async connect(): Promise<DirectoryFixtures> {
    const client = new pg.Client({ connectionString: inject('databaseUrls').directoryApp });
    await client.connect();
    return new DirectoryFixtures(client);
  }

  /** The cell this test's API runs as (`CELL_ID`), created once per database. */
  async cell(name = 'local'): Promise<string> {
    await this.client.query(
      `insert into directory.cells (id, name, region, api_base_url, capacity_users)
       values ($1, $2, 'ap-south-1', 'https://cell.local.test', 20000)
       on conflict (name) do nothing`,
      [newId(), name],
    );
    const { rows } = await this.client.query('select id from directory.cells where name = $1', [
      name,
    ]);
    return rows[0].id;
  }

  async tenant(name: string, status = 'active', cellName = 'local'): Promise<string> {
    const id = newId();
    await this.client.query(
      `insert into directory.tenants (id, slug, name, status, cell_id, template_key, template_version)
       values ($1, $2, $3, $4, $5, 'generic', 1)`,
      [id, `t-${id}`, name, status, await this.cell(cellName)],
    );
    return id;
  }

  /** The membership the directory holds for a user, if any. */
  async membership(
    tenantId: string,
    userId: string,
  ): Promise<{ id: string; status: string; authRevision: number; phone: string } | undefined> {
    const { rows } = await this.client.query(
      `select m.id, m.status, m.auth_revision as "authRevision", i.phone_e164 as phone
         from directory.memberships m join directory.identities i on i.id = m.identity_id
        where m.tenant_id = $1 and m.user_id = $2`,
      [tenantId, userId],
    );
    return rows[0];
  }

  async end(): Promise<void> {
    await this.client.end();
  }
}

/** A user to create; everything is optional and filled with fresh values. */
export type NewUser = Partial<Omit<CreateUserBody, 'managerId'>> & { managerId?: string | null };

/**
 * Tenants and people made through the app's own services, as provisioning will make them: a
 * tenant in the directory with its template's roles, designations and geography in the cell, and
 * users whose memberships the directory hears about.
 */
export class World {
  readonly directory: DirectoryFixtures;
  readonly sender: MemoryOtpSender;
  private readonly app: NestFastifyApplication;

  private constructor(app: NestFastifyApplication, directory: DirectoryFixtures) {
    this.app = app;
    this.directory = directory;
    this.sender = app.get(OtpSender) as MemoryOtpSender;
  }

  static async create(app: NestFastifyApplication): Promise<World> {
    return new World(app, await DirectoryFixtures.connect());
  }

  get database(): Database {
    return this.app.get(Database);
  }

  async tenant(name: string, status = 'active', template = 'generic'): Promise<string> {
    const tenantId = await this.directory.tenant(name, status);
    const { terminology, roles, designations, geographyLevels } = loadTemplate(template);
    await this.database.forTenant(tenantId, async (tx) => {
      await this.app.get(TenantConfigService).applyTemplate(tx, tenantId, { terminology });
      await this.app.get(IamSetup).applyTemplate(tx, tenantId, { roles, designations });
      await this.app.get(TerritoriesService).applyLevels(tx, tenantId, geographyLevels);
    });
    return tenantId;
  }

  /**
   * A user made by the system. By default a manager with a fresh phone number, at the top of the
   * reporting tree, who may use the web.
   */
  async user(tenantId: string, input: NewUser = {}): Promise<UserResult> {
    const body = CreateUserBody.parse({
      code: `T${randomBytes(5).toString('hex')}`,
      name: 'Test Person',
      designation: 'manager',
      phone: newPhone(),
      ...input,
    });
    return this.database.forTenant(tenantId, (tx) =>
      this.app.get(UsersService).create(tx, tenantId, SYSTEM, body),
    );
  }

  /** One person, by phone number, with a user in each tenant. */
  async member(phone: string, tenantIds: string[], input: NewUser = {}) {
    const userIds: string[] = [];
    const membershipIds: string[] = [];
    for (const tenantId of tenantIds) {
      const user = await this.user(tenantId, { ...input, phone });
      userIds.push(user.id);
      membershipIds.push((await this.directory.membership(tenantId, user.id))!.id);
    }
    return { userIds, membershipIds };
  }

  /** A territory one level below its parent, or at the top. */
  territory(tenantId: string, code: string, parentId: string | null = null): Promise<string> {
    return this.database.forTenant(tenantId, (tx) =>
      this.app.get(TerritoriesService).create(tx, tenantId, { code, name: code, parentId }, null),
    );
  }

  /** Attaches a user to a territory over a date range; `validTo` is the first day it no longer applies. */
  async attach(
    tenantId: string,
    userId: string,
    territoryId: string,
    validFrom = '2020-01-01',
    validTo?: string,
  ): Promise<void> {
    await this.database.forTenant(tenantId, async (tx) => {
      await this.app.get(TerritoriesService).attach(tx, tenantId, userId, territoryId, validFrom);
      if (validTo) {
        await tx.execute(
          sql`update cell.user_territories set valid_to = ${validTo}
               where tenant_id = ${tenantId} and user_id = ${userId}
                 and territory_id = ${territoryId} and valid_from = ${validFrom}`,
        );
      }
    });
  }

  /**
   * Requests a code and verifies it, with a phone or on the web, and returns the raw response.
   * Tests sign the same people in many times, so the per-number request limit starts afresh.
   */
  async verify(phone: string, device?: DeviceInfo): Promise<LightMyRequestResponse> {
    const digest = createHash('sha256').update(phone).digest('hex').slice(0, 32);
    await this.app.get(RedisClient).redis.del(`rl:${OTP_LIMITS.requestsPerNumber.name}:${digest}`);
    const remoteAddress = newAddress();
    await this.app.inject({
      method: 'POST',
      url: '/auth/v1/otp/request',
      payload: { phone },
      remoteAddress,
    });
    return this.app.inject({
      method: 'POST',
      url: '/auth/v1/otp/verify',
      payload: { phone, code: this.sender.lastCode(phone), ...(device ? { device } : {}) },
      remoteAddress,
    });
  }

  /** Signs a one-tenant user in, with a phone or on the web, and returns the session. */
  async signIn(
    phone: string,
    device?: DeviceInfo,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await this.verify(phone, device);
    expect(response.json()).toMatchObject({ status: 'signed_in' });
    return response.json().session;
  }

  async end(): Promise<void> {
    await this.directory.end();
  }
}
