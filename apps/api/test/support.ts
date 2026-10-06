import { newId } from '@kshetra/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { inject } from 'vitest';
import { createApp } from '../src/app';
import { type Config, loadConfig } from '../src/config';

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

/**
 * Writes directory rows directly, as the directory's own role does, for tests that need an
 * identity in one or more tenants.
 */
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

  /** An identity with an active membership in each tenant; returns the membership IDs. */
  async member(
    phone: string,
    tenantIds: string[],
  ): Promise<{ userIds: string[]; membershipIds: string[] }> {
    const identityId = newId();
    await this.client.query('insert into directory.identities (id, phone_e164) values ($1, $2)', [
      identityId,
      phone,
    ]);
    const userIds: string[] = [];
    const membershipIds: string[] = [];
    for (const tenantId of tenantIds) {
      const id = newId();
      const userId = newId();
      await this.client.query(
        `insert into directory.memberships (id, identity_id, tenant_id, user_id) values ($1, $2, $3, $4)`,
        [id, identityId, tenantId, userId],
      );
      userIds.push(userId);
      membershipIds.push(id);
    }
    return { userIds, membershipIds };
  }

  async end(): Promise<void> {
    await this.client.end();
  }
}
