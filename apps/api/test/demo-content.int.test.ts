import '../src/demo/clock';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ProvisionTenantInput } from '@thelamp/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DemoContent } from '../src/demo/content';
import { TenantProvisioner } from '../src/modules/provisioning/provisioner';
import { newPhone, startApp, testConfig, World } from './support';

/** The demo content generator (decision D70), on the agri template. */

const urls = inject('databaseUrls');
let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  try {
    return (await admin.query<T>(text, values)).rows;
  } finally {
    await admin.end();
  }
}

describe('demo content (decision D70)', () => {
  it('fills a new demo tenant through the services, and refuses anything else', async () => {
    const provision = (slug: string, demo: boolean) =>
      app.get(TenantProvisioner).provision(
        ProvisionTenantInput.parse({
          name: `Demo ${slug}`,
          slug,
          template: 'agri',
          status: 'active',
          admin: { name: 'Demo Admin', phone: newPhone() },
        }),
        undefined,
        { demo },
      );
    const slug = `demo-content-${Date.now().toString(36)}`;
    const { tenantId } = await provision(slug, true);
    const lines: string[] = [];
    // Ten days take in a Saturday, two holidays and decided requests.
    const counts = await new DemoContent(app, {
      slug,
      days: 10,
      seed: 3,
      log: (line) => lines.push(line),
    }).run();

    // Nothing was refused along the way, and every kind of record was made.
    expect(lines.filter((line) => line.startsWith('Skipping'))).toEqual([]);
    expect(counts.shifts).toBeGreaterThan(0);
    expect(counts.visits).toBeGreaterThan(0);
    expect(counts.entries).toBeGreaterThan(0);
    expect(counts.photos).toBeGreaterThan(0);
    const [made] = await sql<{ people: number; places: number; trails: number; facts: number }>(
      `select (select count(*)::int from cell.users where tenant_id = $1) as people,
              (select count(*)::int from cell.accounts where tenant_id = $1) as places,
              (select count(*)::int from cell.shift_trails where tenant_id = $1) as trails,
              (select count(*)::int from cell.metric_facts_daily where tenant_id = $1) as facts`,
      [tenantId],
    );
    expect(made!.people).toBeGreaterThan(10);
    expect(made!.places).toBeGreaterThan(0);
    expect(made!.trails).toBeGreaterThan(0);
    expect(made!.facts).toBeGreaterThan(0);

    // Phase 2 (decision D86): orders decided along the chain and delivered, statements with
    // invoices and payments, holidays, leave, fixed days and claims, decided and paid.
    expect(counts.orders).toBeGreaterThan(0);
    expect(counts.deliveries).toBeGreaterThan(0);
    expect(counts.claims).toBeGreaterThan(0);
    expect(counts.decisions).toBeGreaterThan(0);
    const [phase2] = await sql<Record<string, number>>(
      `select (select count(*)::int from cell.price_lists where tenant_id = $1) as lists,
              (select count(*)::int from cell.orders where tenant_id = $1 and status = 'fulfilled') as delivered,
              (select count(*)::int from cell.orders where tenant_id = $1 and status = 'submitted') as waiting,
              (select count(*)::int from cell.orders where tenant_id = $1
                  and (placed_at at time zone 'Asia/Kolkata')::date
                      >= (now() at time zone 'Asia/Kolkata')::date - 1) as recent,
              (select count(*)::int from cell.ledger_entries where tenant_id = $1 and reference like 'INV-%') as invoices,
              (select count(*)::int from cell.ledger_entries where tenant_id = $1 and reference like 'RCPT-%') as payments,
              (select count(*)::int from cell.finance_snapshots where tenant_id = $1) as balances,
              (select count(*)::int from cell.holidays where tenant_id = $1) as holidays,
              (select count(*)::int from cell.expense_claims where tenant_id = $1 and state in ('approved', 'paid')) as approved_claims,
              (select count(*)::int from cell.workflow_instances where tenant_id = $1 and status = 'approved') as approved`,
      [tenantId],
    );
    expect(phase2!.lists).toBe(2);
    expect(phase2!.delivered).toBeGreaterThan(0);
    // The last two days' orders wait for their decisions; there are none just after midnight
    // after a Sunday, before the day's work starts.
    if (phase2!.recent! > 0) expect(phase2!.waiting).toBeGreaterThan(0);
    expect(phase2!.invoices).toBeGreaterThan(0);
    expect(phase2!.payments).toBeGreaterThan(0);
    expect(phase2!.balances).toBeGreaterThan(0);
    expect(phase2!.holidays).toBe(2);
    expect(phase2!.approved_claims).toBeGreaterThan(0);
    expect(phase2!.approved).toBeGreaterThan(0);

    // A tenant is filled once, and only a demo tenant.
    await expect(
      new DemoContent(app, { slug, days: 1, seed: 3, log: () => {} }).run(),
    ).rejects.toThrow(/has content already/);
    const realSlug = `real-agro-${Date.now().toString(36)}`;
    await provision(realSlug, false);
    await expect(
      new DemoContent(app, { slug: realSlug, days: 1, seed: 3, log: () => {} }).run(),
    ).rejects.toThrow(/isn't a demo tenant/);
  }, 300_000);
});
