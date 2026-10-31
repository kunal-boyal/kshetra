import { newId, type PayDay, provisionalPay, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportsService } from '../src/modules/imports/imports.service';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Payroll inputs (M14, BR-26, decisions D14 and D117). */

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
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
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
    patch: (url: string, payload: object) => call('PATCH', url, payload),
    upload: (body: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/imports?target=payroll_gross&fileName=gross.csv',
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': newId(),
          'content-type': 'text/csv',
        },
        payload: body,
      }),
  };
}
type Api = ReturnType<typeof as>;

const DAY = 86_400_000;
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const THIS_MONTH = () => todayIn('Asia/Kolkata').slice(0, 7);
const LAST_MONTH = () => shift(`${THIS_MONTH()}-01`, -1).slice(0, 7);
const BEFORE = () => shift(`${LAST_MONTH()}-01`, -1).slice(0, 7);

/** A tenant with its head (the admin), a manager, a field user and someone who joined mid-month. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { head: newPhone(), manager: newPhone(), field: newPhone(), joiner: newPhone() };
  const head = await world.user(tenantId, {
    phone: phones.head,
    designation: 'head',
    role: 'tenant_admin',
  });
  const manager = await world.user(tenantId, {
    phone: phones.manager,
    designation: 'manager',
    managerId: head.id,
  });
  const field = await world.user(tenantId, {
    phone: phones.field,
    designation: 'executive',
    managerId: manager.id,
    joiningDate: '2020-01-01',
  });
  const joiner = await world.user(tenantId, {
    phone: phones.joiner,
    designation: 'executive',
    managerId: manager.id,
    joiningDate: `${LAST_MONTH()}-15`,
  });
  return {
    tenantId,
    fieldId: field.id,
    joinerId: joiner.id,
    head: as((await world.signIn(phones.head)).accessToken),
    field: as((await world.signIn(phones.field, newDevice())).accessToken),
  };
}

type Day = { date: string; status: string; value: number };

/** A person's days of a month, as attendance says. */
async function days(api: Api, userId: string, period: string) {
  const answer = await api.get(`/v1/attendance?userId=${userId}&period=${period}`);
  expect(answer.statusCode, answer.body).toBe(200);
  return answer.json() as { days: Day[]; summary: { scheduled: number } };
}

/** Days worked, as shifts on the record, which make each day present. */
async function worked(tenantId: string, userId: string, dates: readonly string[]) {
  await world.database.forTenant(tenantId, async (tx) => {
    for (const date of dates) {
      await tx.execute(sql`
        insert into cell.shifts (id, tenant_id, user_id, started_at, ended_at, start_point,
          start_accuracy, consent_version)
        values (${newId()}, ${tenantId}, ${userId}, ${`${date}T04:00:00Z`}::timestamptz,
          ${`${date}T12:00:00Z`}::timestamptz,
          ST_SetSRID(ST_MakePoint(77.2167, 28.6315), 4326)::geography, 12, '2026-10')`);
    }
  });
}

/** What BR-26 makes of a month: worked days paid, the rest of the scheduled days not. */
const expected = (gross: string, paid: number, scheduled: number) =>
  provisionalPay(gross, [
    ...Array.from({ length: paid }, (): PayDay => ({ status: 'present', value: 1, working: true })),
    ...Array.from({ length: scheduled - paid }, (): PayDay => ({
      status: 'absent',
      value: 0,
      working: true,
    })),
  ]).amount;

const row = (answer: { json: () => { items: { user: { id: string } }[] } }, userId: string) =>
  answer.json().items.find((item) => item.user.id === userId);

describe('payroll inputs (M14, BR-26, decision D117)', () => {
  it('prices each month on its own gross, a joiner’s part month and this month so far', async () => {
    const t = await tenant('Payroll Co');
    const last = LAST_MONTH();

    // Three working days last month for the field user, one after joining for the joiner.
    const month = await days(t.head, t.fieldId, last);
    const open = month.days.filter((day) => day.status === 'absent').map((day) => day.date);
    await worked(t.tenantId, t.fieldId, open.slice(0, 3));
    const joinerDay = open.find((date) => date >= `${last}-15`)!;
    await worked(t.tenantId, t.joinerId, [joinerDay]);
    const scheduled = month.summary.scheduled;

    // Without a gross, a person is listed with no estimate.
    let list = await t.head.get(`/v1/payroll?period=${last}`);
    expect(list.statusCode, list.body).toBe(200);
    expect(row(list, t.fieldId)).toMatchObject({ monthlyGross: null, amount: null, paid: 3 });

    // Gross from last month, then a raise from this month.
    const set = await t.head.put(`/v1/payroll-gross/${t.fieldId}`, {
      monthlyGross: '30000',
      from: last,
    });
    expect(set.statusCode, set.body).toBe(200);
    const raised = await t.head.put(`/v1/payroll-gross/${t.fieldId}`, { monthlyGross: '36000' });
    expect(raised.json()).toEqual({
      userId: t.fieldId,
      changes: [
        { from: last, monthlyGross: '30000.00' },
        { from: THIS_MONTH(), monthlyGross: '36000.00' },
      ],
    });
    // A month before the latest change is refused, so months already priced keep their gross.
    const earlier = await t.head.put(`/v1/payroll-gross/${t.fieldId}`, {
      monthlyGross: '20000',
      from: BEFORE(),
    });
    expect(earlier.json().error.details).toEqual([
      { path: 'from', issue: `Start in ${THIS_MONTH()} or later, when the gross last changed` },
    ]);
    await t.head.put(`/v1/payroll-gross/${t.joinerId}`, { monthlyGross: '20000', from: last });

    list = await t.head.get(`/v1/payroll?period=${last}`);
    expect(row(list, t.fieldId)).toMatchObject({
      monthlyGross: '30000.00',
      scheduled,
      paid: 3,
      amount: expected('30000', 3, scheduled),
      toDate: false,
    });
    // The joiner's days before joining are scheduled but unpaid: a part of the gross.
    expect(row(list, t.joinerId)).toMatchObject({
      monthlyGross: '20000.00',
      scheduled,
      paid: 1,
      amount: expected('20000', 1, scheduled),
    });

    // This month is on the raise, earned so far.
    const now = (await t.head.get(`/v1/payroll?period=${THIS_MONTH()}`)).json();
    expect(row({ json: () => now }, t.fieldId)).toMatchObject({
      monthlyGross: '36000.00',
      toDate: true,
    });
    expect(
      (await t.head.get(`/v1/payroll?period=${shift(`${THIS_MONTH()}-01`, 40).slice(0, 7)}`)).json()
        .error.details,
    ).toEqual([{ path: 'period', issue: 'Choose this month or one before it' }]);

    // The payslip: one's own with payslip.view, another's only with payroll.manage.
    const own = await t.field.get(`/v1/payslips/${t.fieldId}/${last}`);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json()).toMatchObject({
      monthlyGross: '30000.00',
      amount: expected('30000', 3, scheduled),
      days: { present: 3 },
    });
    expect((await t.field.get(`/v1/payslips/${t.joinerId}/${last}`)).statusCode).toBe(403);
    expect((await t.field.get(`/v1/payroll?period=${last}`)).statusCode).toBe(403);
    expect((await t.head.get(`/v1/payslips/${t.joinerId}/${last}`)).json()).toMatchObject({
      paid: 1,
      days: { present: 1 },
    });

    // The summary report, for payroll providers.
    const report = await t.head.get(`/v1/reports/payroll_summary?period=${last}&limit=50`);
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().rows).toContainEqual(
      expect.objectContaining({
        monthly_gross: 30000,
        scheduled_days: scheduled,
        present: 3,
        paid_days: 3,
        provisional_pay: Number(expected('30000', 3, scheduled)),
      }),
    );

    // The figure stays out of the audit log.
    const audit = (await t.head.get(`/v1/audit?period=${THIS_MONTH()}`)).json();
    const changes = audit.items.filter(
      (entry: { action: string }) => entry.action === 'payroll.gross_changed',
    );
    expect(changes.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(changes)).not.toContain('30000');
  });

  it('imports gross from a month, and closes with its module', async () => {
    const t = await tenant('Payroll Import Co');
    const last = LAST_MONTH();
    const codes = (await t.head.get(`/v1/payroll?period=${last}`)).json().items as {
      user: { id: string; code: string };
    }[];
    const code = codes.find((item) => item.user.id === t.fieldId)!.user.code;
    const imports = app.get(ImportsService);
    const run = async (csv: string) => {
      const uploaded = await t.head.upload(csv);
      expect(uploaded.statusCode, uploaded.body).toBe(201);
      const id = uploaded.json().id as string;
      await imports.read(t.tenantId, id);
      const read = (await t.head.get(`/v1/imports/${id}`)).json();
      await t.head.put(`/v1/imports/${id}/mapping`, { mapping: read.mapping });
      await imports.check(t.tenantId, id);
      const checked = (await t.head.get(`/v1/imports/${id}`)).json();
      if (checked.status !== 'ready') return checked;
      await t.head.post(`/v1/imports/${id}/commit`);
      await imports.write(t.tenantId, id);
      return (await t.head.get(`/v1/imports/${id}`)).json();
    };
    const refused = await run(
      ['Employee code,Monthly gross,From month', 'NOBODY,1000,', `${code},a lot,`].join('\n'),
    );
    expect(refused.status).toBe('invalid');
    expect(
      refused.errors.map((error: { row: number; field: string | null }) => [
        error.row,
        error.field,
      ]),
    ).toEqual([
      [2, 'code'],
      [3, 'gross'],
    ]);
    const done = await run(
      ['Employee code,Monthly gross,From month', `${code},"28,000",${last}`, `${code},29000,`].join(
        '\n',
      ),
    );
    expect(done.status, JSON.stringify(done)).toBe('committed');
    expect((await t.head.get(`/v1/payroll-gross/${t.fieldId}`)).json().changes).toEqual([
      { from: last, monthlyGross: '28000.00' },
      { from: THIS_MONTH(), monthlyGross: '29000.00' },
    ]);

    // Switched off, payroll answers MODULE_DISABLED and its report closes.
    const off = await t.head.patch('/v1/settings', { modulesOff: ['payroll_inputs'] });
    expect(off.statusCode, off.body).toBe(200);
    expect((await t.head.get(`/v1/payroll?period=${last}`)).json().error.code).toBe(
      'MODULE_DISABLED',
    );
    expect((await t.field.get(`/v1/payslips/${t.fieldId}/${last}`)).json().error.code).toBe(
      'MODULE_DISABLED',
    );
    expect((await t.head.get(`/v1/reports/payroll_summary?period=${last}`)).statusCode).not.toBe(
      200,
    );
  });
});
