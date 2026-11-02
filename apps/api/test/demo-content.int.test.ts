import { haltTravel, resumeTravel, returnToNow } from '../src/demo/clock';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ProvisionTenantInput } from '@thelamp/shared';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { DemoContent } from '../src/demo/content';
import { TenantProvisioner } from '../src/modules/provisioning/provisioner';
import { newPhone, startApp, testConfig, World } from './support';

/** The demo content generator (decision D70), on the agri, pharma and FMCG templates (D97). */

const urls = inject('databaseUrls');
let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
});

/** The generator a test started: one its test gave up on is stopped before the next test. */
let running: Promise<unknown> | undefined;

function fill(options: ConstructorParameters<typeof DemoContent>[1]) {
  const run = new DemoContent(app, options).run();
  running = run;
  return run;
}

// A halted generator stops within one person's day, which can take a minute beside the suite.
afterEach(async () => {
  haltTravel();
  await running?.catch(() => {});
  running = undefined;
  resumeTravel();
  returnToNow();
}, 120_000);

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

const provision = (slug: string, demo: boolean, template = 'agri') =>
  app.get(TenantProvisioner).provision(
    ProvisionTenantInput.parse({
      name: `Demo ${slug}`,
      slug,
      template,
      status: 'active',
      admin: { name: 'Demo Admin', phone: newPhone() },
    }),
    undefined,
    { demo },
  );

/**
 * Each run fills weeks of a tenant's work: about a minute alone, but `pnpm verify` runs it beside
 * the whole integration suite, where it has taken over five, so the limit only catches a hang.
 */
const DEMO_TIMEOUT_MS = 600_000;

describe('demo content (decision D70)', () => {
  it(
    'fills a new demo tenant through the services, and refuses anything else',
    async () => {
      const slug = `demo-content-${Date.now().toString(36)}`;
      const { tenantId } = await provision(slug, true);
      const lines: string[] = [];
      // Ten days take in a Saturday, two holidays and decided requests.
      const counts = await fill({
        slug,
        days: 10,
        seed: 3,
        log: (line) => lines.push(line),
        statutory: true,
      });

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

      // Advanced analytics (decision D122): the managers' Home is laid out and the admin gets the
      // monthly workbook.
      const [analytics] = await sql<{ layouts: number; schedules: number }>(
        `select (select count(*)::int from cell.dashboard_layouts l join cell.roles r
                   on r.tenant_id = l.tenant_id and r.id = l.role_id
                  where l.tenant_id = $1 and r.key = 'manager' and l.cards is not null) as layouts,
                (select count(*)::int from cell.report_schedules
                  where tenant_id = $1 and report = 'workbook' and frequency = 'monthly') as schedules`,
        [tenantId],
      );
      expect(analytics).toEqual({ layouts: 1, schedules: 1 });
      // Distributors and retailers gave this month's stock statement, liquidation in agri (D124).
      expect(counts.statements).toBeGreaterThan(0);
      const [stock] = await sql<{ statements: number; lines: number }>(
        `select (select count(*)::int from cell.sell_through_statements where tenant_id = $1) as statements,
                (select count(*)::int from cell.sell_through_lines where tenant_id = $1) as lines`,
        [tenantId],
      );
      expect(stock!.statements).toBe(counts.statements);
      expect(stock!.lines).toBeGreaterThan(stock!.statements);
      // Field people forecast the accounts they hold for the months still open (D126).
      expect(counts.forecasts).toBeGreaterThan(0);
      const [forecast] = await sql<{ forecasts: number; lines: number }>(
        `select (select count(*)::int from cell.forecasts where tenant_id = $1) as forecasts,
                (select count(*)::int from cell.forecast_lines where tenant_id = $1) as lines`,
        [tenantId],
      );
      expect(forecast!.forecasts).toBe(counts.forecasts);
      expect(forecast!.lines).toBeGreaterThanOrEqual(forecast!.forecasts * 2);
      // The tenant runs three schemes, and some of its orders carry them (D127).
      expect(counts.schemes).toBe(3);
      const [schemed] = await sql<{ lines: number }>(
        `select count(*)::int as lines from cell.order_lines where tenant_id = $1 and scheme is not null`,
        [tenantId],
      );
      expect(schemed!.lines).toBeGreaterThan(0);
      // With --statutory, last month's pay run is approved for everyone given a salary, and one
      // person's PAN isn't on file (D128).
      const runs = await sql<{ period: string; status: string; payslips: number; no_pan: number }>(
        `select r.period, r.status,
                (select count(*)::int from cell.payslips p
                  where p.tenant_id = r.tenant_id and p.pay_run_id = r.id and p.included) as payslips,
                (select count(*)::int from cell.payslips p
                  where p.tenant_id = r.tenant_id and p.pay_run_id = r.id and p.included
                    and p.figures->'flags' ? 'no_pan') as no_pan
           from cell.pay_runs r where r.tenant_id = $1`,
        [tenantId],
      );
      const structures = await sql<{ people: number }>(
        `select count(distinct user_id)::int as people from cell.salary_structures where tenant_id = $1`,
        [tenantId],
      );
      expect(runs).toEqual([
        {
          period: expect.stringMatching(/^\d{4}-\d{2}$/),
          status: 'approved',
          payslips: structures[0]!.people,
          no_pan: 1,
        },
      ]);
      expect(structures[0]!.people).toBeGreaterThan(8);

      // A tenant is filled once, and only a demo tenant.
      await expect(fill({ slug, days: 1, seed: 3, log: () => {} })).rejects.toThrow(
        /has content already/,
      );
      const realSlug = `real-agro-${Date.now().toString(36)}`;
      await provision(realSlug, false);
      await expect(fill({ slug: realSlug, days: 1, seed: 3, log: () => {} })).rejects.toThrow(
        /isn't a demo tenant/,
      );
    },
    DEMO_TIMEOUT_MS,
  );

  it(
    'fills a pharma demo tenant in its own words, without a refusal (decision D97)',
    async () => {
      const slug = `demo-pharma-${Date.now().toString(36)}`;
      const { tenantId } = await provision(slug, true, 'pharma');
      const lines: string[] = [];
      const counts = await fill({
        slug,
        days: 10,
        seed: 5,
        log: (line) => lines.push(line),
      });
      expect(lines.filter((line) => line.startsWith('Skipping'))).toEqual([]);
      expect(counts.entries).toBeGreaterThan(0);
      expect(counts.orders).toBeGreaterThan(0);

      const [made] = await sql<Record<string, number>>(
        `select (select count(*)::int from cell.accounts a join cell.account_types t
                 on t.tenant_id = a.tenant_id and t.id = a.type_id
                where a.tenant_id = $1 and t.key = 'doctor' and a.name like 'Dr. %') as doctors,
              (select count(*)::int from cell.accounts a join cell.account_types t
                 on t.tenant_id = a.tenant_id and t.id = a.type_id
                where a.tenant_id = $1 and t.key = 'doctor' and a.segments <> '{}') as classed,
              (select count(*)::int from cell.submissions s join cell.forms f
                 on f.tenant_id = s.tenant_id and f.id = s.form_id
                where s.tenant_id = $1 and f.key = 'doctor_call') as calls,
              (select count(*)::int from cell.submissions s join cell.forms f
                 on f.tenant_id = s.tenant_id and f.id = s.form_id
                where s.tenant_id = $1 and f.key = 'doctor_call'
                  and jsonb_array_length(coalesce(s.data->'samples', '[]')) > 0
                  and s.signature_strokes is null) as unsigned_samples,
              (select count(*)::int from cell.orders o join cell.accounts a
                 on a.tenant_id = o.tenant_id and a.id = o.account_id
                 join cell.account_types t on t.tenant_id = a.tenant_id and t.id = a.type_id
                where o.tenant_id = $1 and t.key in ('doctor', 'hospital')) as doctor_orders,
              (select count(*)::int from cell.metric_facts_daily
                where tenant_id = $1 and metric_key = 'samples_distributed' and value > 0) as samples`,
        [tenantId],
      );
      expect(made!.doctors).toBeGreaterThan(0);
      expect(made!.classed).toBe(made!.doctors);
      expect(made!.calls).toBeGreaterThan(0);
      // Samples are signed for; orders are taken from chemists and stockists, never doctors.
      expect(made!.unsigned_samples).toBe(0);
      expect(made!.doctor_orders).toBe(0);
      expect(made!.samples).toBeGreaterThan(0);
    },
    DEMO_TIMEOUT_MS,
  );

  it(
    'fills an FMCG demo tenant, asking why only where no order was taken (decision D97)',
    async () => {
      const slug = `demo-fmcg-${Date.now().toString(36)}`;
      const { tenantId } = await provision(slug, true, 'fmcg');
      const lines: string[] = [];
      const counts = await fill({
        slug,
        days: 10,
        seed: 9,
        log: (line) => lines.push(line),
      });
      expect(lines.filter((line) => line.startsWith('Skipping'))).toEqual([]);
      expect(counts.orders).toBeGreaterThan(0);
      expect(counts.proposals).toBeGreaterThan(0);

      const [made] = await sql<Record<string, number>>(
        `with calls as (
         select s.data, exists (select 1 from cell.orders o
                                 where o.tenant_id = s.tenant_id and o.visit_id = s.visit_id) as ordered
           from cell.submissions s join cell.forms f on f.tenant_id = s.tenant_id and f.id = s.form_id
          where s.tenant_id = $1 and f.key = 'outlet_visit')
       select (select count(*)::int from calls where ordered) as ordered,
              (select count(*)::int from calls where not ordered) as unordered,
              (select count(*)::int from calls where ordered = (data ? 'no_order_reason')) as mismatched,
              (select count(*)::int from cell.accounts a join cell.account_types t
                 on t.tenant_id = a.tenant_id and t.id = a.type_id
                where a.tenant_id = $1 and t.key = 'outlet' and a.parent_account_id is not null) as supplied,
              (select count(*)::int from cell.metric_facts_daily
                where tenant_id = $1 and metric_key = 'new_outlets' and value > 0) as new_outlets,
              (select count(*)::int from cell.metric_facts_daily
                where tenant_id = $1 and metric_key = 'productive_calls' and value > 0) as productive`,
        [tenantId],
      );
      expect(made!.ordered).toBeGreaterThan(0);
      expect(made!.unordered).toBeGreaterThan(0);
      // The reason is kept exactly when the visit took no order.
      expect(made!.mismatched).toBe(0);
      expect(made!.supplied).toBeGreaterThan(0);
      expect(made!.new_outlets).toBeGreaterThan(0);
      expect(made!.productive).toBeGreaterThan(0);
    },
    DEMO_TIMEOUT_MS,
  );

  it(
    'fills a building materials demo tenant in its own words, without a refusal (decision D120)',
    async () => {
      const slug = `demo-building-${Date.now().toString(36)}`;
      const { tenantId } = await provision(slug, true, 'building');
      const lines: string[] = [];
      const counts = await fill({
        slug,
        days: 10,
        seed: 13,
        log: (line) => lines.push(line),
      });
      expect(lines.filter((line) => line.startsWith('Skipping'))).toEqual([]);
      expect(counts.entries).toBeGreaterThan(0);
      expect(counts.orders).toBeGreaterThan(0);

      const [made] = await sql<Record<string, number>>(
        `with visits as (
         select s.data, s.status from cell.submissions s
           join cell.forms f on f.tenant_id = s.tenant_id and f.id = s.form_id
          where s.tenant_id = $1 and f.key = 'site_visit')
       select (select count(*)::int from visits) as site_visits,
              (select count(*)::int from visits where (data->>'ordered_from_dealer')::boolean
                 and not (data ? 'dealer')) as undealt,
              (select count(*)::int from visits where not (data->>'ordered_from_dealer')::boolean
                 and data ? 'dealer') as stray_dealer,
              (select count(*)::int from cell.accounts a join cell.account_types t
                 on t.tenant_id = a.tenant_id and t.id = a.type_id
                where a.tenant_id = $1 and t.key = 'dealer' and a.name ~ '(Paint|Colour)') as dealers,
              (select count(*)::int from cell.accounts
                where tenant_id = $1 and name ~* '(krishi|agro|kirana|seeds)') as other_words,
              (select count(*)::int from cell.metric_facts_daily
                where tenant_id = $1 and metric_key = 'dealer_sales' and value > 0) as sales,
              (select count(*)::int from cell.metric_facts_daily
                where tenant_id = $1 and metric_key = 'sites_converted' and value > 0) as converted`,
        [tenantId],
      );
      expect(made!.site_visits).toBeGreaterThan(0);
      // The dealer is named exactly when the site ordered from one.
      expect(made!.undealt).toBe(0);
      expect(made!.stray_dealer).toBe(0);
      expect(made!.dealers).toBeGreaterThan(0);
      expect(made!.other_words).toBe(0);
      expect(made!.sales).toBeGreaterThan(0);
      expect(made!.converted).toBeGreaterThan(0);
    },
    DEMO_TIMEOUT_MS,
  );
});
