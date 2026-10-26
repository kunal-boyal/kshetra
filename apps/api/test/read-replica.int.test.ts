import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppError, newId, todayIn } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Database, replicaUrl } from '../src/platform/database';
import { newAddress, newPhone, startApp, testConfig, World } from './support';

/**
 * Reads on the replica (spec 10.3 and 11, decision D98): reports, exports and API clients' list
 * reads go to the read replica, read only, with a statement timeout; people in the apps keep
 * reading the primary. Here the "replica" is the same database through its own pool, as a cell
 * without a replica reads the primary the same way.
 */

let app: NestFastifyApplication;
let world: World;
let database: Database;
/** Connections taken from the replica's pool since the last look. */
let replicaUses = 0;

beforeAll(async () => {
  const url = new URL(inject('databaseUrls').cellApp);
  url.searchParams.set('application_name', 'replica-test');
  app = await startApp(testConfig({ DATABASE_REPLICA_URL: url.toString() }));
  world = await World.create(app);
  database = app.get(Database);
  database.replica!.on('acquire', () => {
    replicaUses += 1;
  });
});

afterAll(async () => {
  await world.end();
  await app.close();
});

const used = () => {
  const count = replicaUses;
  replicaUses = 0;
  return count;
};

function call(url: string, token: string) {
  return app.inject({
    method: 'GET',
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('reads on the replica (decision D98)', () => {
  it('takes the replica for API clients’ lists and for reports, never for people’s lists', async () => {
    const tenantId = await world.tenant('Replica Traders');
    const phone = newPhone();
    await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
    const token = (await world.signIn(phone)).accessToken;
    const made = (
      await app.inject({
        method: 'POST',
        url: '/v1/api-clients',
        remoteAddress: newAddress(),
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
        payload: { id: newId(), name: 'ERP', scopes: ['accounts:read', 'reports:read'] },
      })
    ).json();
    const client = (
      await app.inject({
        method: 'POST',
        url: '/auth/v1/oauth/token',
        remoteAddress: newAddress(),
        payload: {
          grant_type: 'client_credentials',
          client_id: made.client.clientId,
          client_secret: made.clientSecret,
        },
      })
    ).json().access_token as string;

    used();
    expect((await call('/v1/accounts', token)).statusCode).toBe(200);
    expect(used()).toBe(0);
    expect((await call('/v1/accounts', client)).statusCode).toBe(200);
    expect(used()).toBe(1);
    const month = todayIn('Asia/Kolkata').slice(0, 7);
    const report = await call(`/v1/reports/visit_compliance?period=${month}`, token);
    expect(report.statusCode, report.body).toBe(200);
    expect(used()).toBe(1);
    expect((await call(`/v1/dashboard?period=${month}`, token)).statusCode).toBe(200);
    expect(used()).toBe(1);
  });

  it('reads only, and stops a statement that runs too long', async () => {
    const tenantId = await world.tenant('Slow Traders');
    await expect(
      database.read(tenantId, (tx) => tx.execute(sql`select pg_sleep(1)`), { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: 'REPORT_TIMEOUT' } satisfies Partial<AppError>);
    await expect(
      database.read(tenantId, (tx) =>
        tx.execute(sql`update cell.users set name = name where tenant_id = ${tenantId}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '25006' } }); // read_only_sql_transaction
    // Row-level security still applies on the replica.
    const seen = await database.read(tenantId, (tx) =>
      tx.execute(sql`select count(*)::int as n from cell.users`),
    );
    expect(seen.rows).toEqual([{ n: 0 }]);
  });

  it('builds the replica’s address from its host, keeping the role and database', () => {
    expect(
      replicaUrl({
        DATABASE_URL:
          'postgres://cell_app:p%40ss@primary.internal:5432/thelamp?sslmode=verify-full',
        DATABASE_REPLICA_URL: undefined,
        DATABASE_REPLICA_HOST: 'replica.internal',
      }),
    ).toBe('postgres://cell_app:p%40ss@replica.internal:5432/thelamp?sslmode=verify-full');
    expect(
      replicaUrl({
        DATABASE_URL: 'postgres://a@b/c',
        DATABASE_REPLICA_URL: undefined,
        DATABASE_REPLICA_HOST: undefined,
      }),
    ).toBeNull();
  });
});
