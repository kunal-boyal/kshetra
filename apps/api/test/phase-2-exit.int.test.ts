import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId, scaled, todayIn } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/**
 * Phase 2's exit checks (spec 15, decision D86), in an agri tenant: order totals reconcile with
 * invoices to the paisa; leave, regularisation and claims pass through their configured chains;
 * and the attendance register agrees with a count made by hand. The real invoices and Kunal's
 * own check of a month stay with him; this proves the parts the code decides.
 */

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

function as(token: string) {
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
    put: (url: string, payload: object) => call('PUT', url, payload),
  };
}

const DAY = 86_400_000;
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

/** A business head (the admin), an ASM and a field user, as the agri template's chains expect. */
async function agri(name: string) {
  const tenantId = await world.tenant(name, 'active', 'agri');
  const phones = { head: newPhone(), asm: newPhone(), sme: newPhone() };
  const head = await world.user(tenantId, {
    phone: phones.head,
    designation: 'business_head',
    role: 'tenant_admin',
  });
  const asm = await world.user(tenantId, {
    phone: phones.asm,
    designation: 'asm',
    role: 'manager',
    managerId: head.id,
  });
  const sme = await world.user(tenantId, {
    name: 'Sachin More',
    phone: phones.sme,
    designation: 'sme',
    managerId: asm.id,
    joiningDate: '2020-01-01',
  });
  return {
    tenantId,
    asm,
    sme,
    api: {
      head: as((await world.signIn(phones.head)).accessToken),
      asm: as((await world.signIn(phones.asm)).accessToken),
      sme: as((await world.signIn(phones.sme, newDevice())).accessToken),
    },
  };
}

interface Invoice {
  label: string;
  lines: {
    item: string;
    unit: string;
    perUnit: string;
    quantity: string;
    price: string;
    discount: string;
    taxRate: string;
  }[];
  totals: Record<'taxable' | 'tax' | 'cgst' | 'sgst' | 'total', string>;
}

/** The fictional sample, and any real invoices Kunal has put in `private/`. */
function invoices(): { file: string; invoice: Invoice }[] {
  const folder = join(import.meta.dirname, 'fixtures', 'invoices');
  const read = (dir: string) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((file) => file.endsWith('.json'))
          .map((file) => ({
            file: join(dir, file).slice(folder.length + 1),
            invoice: JSON.parse(readFileSync(join(dir, file), 'utf8')) as Invoice,
          }))
      : [];
  return [...read(folder), ...read(join(folder, 'private'))];
}

describe('phase 2 exit: order totals reconcile with invoices to the paisa', () => {
  it.each(invoices())('$file', async ({ invoice }) => {
    const t = await agri('Invoice Co');
    const market = await world.territory(t.tenantId, `M-${newId().slice(-6)}`);
    const distributor = newId();
    const made = await t.api.head.post('/v1/accounts', {
      id: distributor,
      type: 'distributor',
      code: `D-${newId().slice(-6)}`,
      name: 'Invoice Distributor',
      territoryId: market,
      slots: { asm: t.asm.id, sme: t.sme.id },
    });
    expect(made.statusCode, made.body).toBe(201);

    // Each line's item, priced on the company's list as the invoice prices it.
    const list = newId();
    const listed = await t.api.head.put(`/v1/price-lists/${list}`, {
      name: 'Invoice rates',
      scope: 'default',
      validFrom: '2026-01-01',
    });
    expect(listed.statusCode, listed.body).toBe(201);
    const items = new Map<number, string>();
    for (const [index, line] of invoice.lines.entries()) {
      const id = newId();
      const item = await t.api.head.put(`/v1/items/${id}`, {
        code: `${line.item}-${index + 1}`,
        name: line.item,
        productName: line.item,
        categoryName: null,
        packLabel: null,
        hsn: null,
        taxRate: line.taxRate,
        mrp: null,
        baseUnit: 'pack',
        units: line.unit === 'pack' ? [] : [{ key: line.unit, factor: line.perUnit }],
        measureType: null,
        measurePerBaseUnit: null,
      });
      expect(item.statusCode, item.body).toBe(201);
      items.set(index, id);
    }
    const { version } = (await t.api.head.get(`/v1/price-lists/${list}`)).json();
    const priced = await t.api.head.put(`/v1/price-lists/${list}/items`, {
      set: invoice.lines.map((line, index) => ({
        itemId: items.get(index),
        price: line.price,
        discount: line.discount,
      })),
      version,
    });
    expect(priced.statusCode, priced.body).toBe(200);

    // Placed at the order desk, as the office would key the invoice's order in.
    const placed = await t.api.head.post('/v1/orders', {
      id: newId(),
      accountId: distributor,
      lines: invoice.lines.map((line, index) => ({
        itemId: items.get(index),
        unitKey: line.unit,
        quantity: line.quantity,
        quoted: {
          listId: list,
          price: line.price,
          discount: line.discount,
          taxRate: line.taxRate,
          factor: line.perUnit,
        },
      })),
      placedAt: new Date().toISOString(),
    });
    expect(placed.statusCode, placed.body).toBe(201);
    const totals = placed.json().totals as Invoice['totals'];
    const differences = (Object.keys(invoice.totals) as (keyof Invoice['totals'])[])
      .filter((key) => scaled(totals[key], 2) !== scaled(invoice.totals[key], 2))
      .map((key) => `${key}: the order says ${totals[key]}, the invoice ${invoice.totals[key]}`);
    expect(differences, invoice.label).toEqual([]);
  });
});

describe('phase 2 exit: requests through their chains, and the register by hand', () => {
  it('passes leave, a regularisation and claims through their chains, and the register agrees', async () => {
    const t = await agri('Exit Co');
    const today = todayIn('Asia/Kolkata');
    const period = shift(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const days: string[] = [];
    for (let date = `${period}-01`; date.startsWith(period); date = shift(date, 1)) days.push(date);
    const weekdays = days.filter((date) => weekday(date) !== 7);
    const [holiday, , leaveFrom, leaveTo, , fixed, claimed] = weekdays as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    /** Both steps of a chain: the reporting manager, then the business head. */
    const approveBoth = async (approval: { id: string; version: number }) => {
      const first = await t.api.asm.post(`/v1/approvals/${approval.id}/decision`, {
        decision: 'approve',
        version: approval.version,
      });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({
        status: 'pending',
        steps: [{ status: 'approved' }, {}],
      });
      const last = await t.api.head.post(`/v1/approvals/${approval.id}/decision`, {
        decision: 'approve',
        version: first.json().version,
      });
      expect(last.statusCode, last.body).toBe(200);
      expect(last.json().status).toBe('approved');
    };

    const holidayAdded = await t.api.head.put(`/v1/calendars/standard/holidays/${holiday}`, {
      name: 'Company foundation day',
    });
    expect(holidayAdded.statusCode, holidayAdded.body).toBe(200);

    const leave = await t.api.sme.post('/v1/leave-requests', {
      id: newId(),
      leaveType: 'casual',
      startDate: leaveFrom,
      endDate: leaveTo,
      reason: 'Family function',
    });
    expect(leave.statusCode, leave.body).toBe(201);
    expect(leave.json()).toMatchObject({ days: 2, state: 'pending' });
    await approveBoth(leave.json().approval);

    const fix = await t.api.sme.post('/v1/regularisations', {
      id: newId(),
      date: fixed,
      status: 'present',
      reason: 'Worked at the distributor’s godown; forgot to punch in.',
    });
    expect(fix.statusCode, fix.body).toBe(201);
    await approveBoth(fix.json().approval);

    // A claim through both steps and paid; another turned down at the first.
    const claim = async (description: string) => {
      const made = await t.api.sme.post('/v1/expense-claims', {
        id: newId(),
        policy: 'daily_allowance',
        expenseDate: claimed,
        description,
        days: '2',
      });
      expect(made.statusCode, made.body).toBe(201);
      return made.json();
    };
    const allowance = await claim('Daily allowance for two days of market visits');
    expect(allowance).toMatchObject({ amount: '500.00', state: 'pending' });
    await approveBoth(allowance.approval);
    const paid = await t.api.head.post(`/v1/expense-claims/${allowance.id}/paid`, {
      reference: 'NEFT2026000123',
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().state).toBe('paid');
    const doubled = await claim('Daily allowance again for the same two days');
    const refused = await t.api.asm.post(`/v1/approvals/${doubled.approval.id}/decision`, {
      decision: 'reject',
      version: doubled.approval.version,
      note: 'Already claimed these days',
    });
    expect(refused.json().status).toBe('rejected');
    const claims = await t.api.sme.get(`/v1/expense-claims?period=${period}`);
    expect(
      claims.json().items.map((item: { id: string; state: string }) => [item.id, item.state]),
    ).toEqual(
      expect.arrayContaining([
        [allowance.id, 'paid'],
        [doubled.id, 'rejected'],
      ]),
    );

    // The month counted by hand: Sundays off, the holiday, two days of paid leave, the fixed
    // day present, and every other weekday absent, as nobody punched in.
    const expected = new Map(
      days.map((date) => [
        date,
        weekday(date) === 7
          ? 'weekly_off'
          : date === holiday
            ? 'holiday'
            : date === leaveFrom || date === leaveTo
              ? 'paid_leave'
              : date === fixed
                ? 'present'
                : 'absent',
      ]),
    );
    const month = await t.api.asm.get(`/v1/attendance?userId=${t.sme.id}&period=${period}`);
    expect(month.statusCode, month.body).toBe(200);
    expect(
      new Map(
        (month.json().days as { date: string; status: string }[]).map((day) => [
          day.date,
          day.status,
        ]),
      ),
    ).toEqual(expected);

    // The register says the same, a row a day in words.
    const register = await t.api.head.get(
      `/v1/reports/attendance_register?period=${period}&userId=${t.sme.id}&limit=100`,
    );
    expect(register.statusCode, register.body).toBe(200);
    const rows = register.json().rows as { date: string; user_name: string; day_status: string }[];
    expect(rows.map((row) => row.date)).toEqual(days);
    const words = new Map<string, string>();
    for (const row of rows) {
      const status = expected.get(row.date)!;
      words.set(status, words.get(status) ?? row.day_status);
      expect(row.day_status, row.date).toBe(words.get(status));
    }
    expect(new Set(words.values()).size).toBe(words.size);
    expect(words.get('present')).toBe('Present');
  });
});
