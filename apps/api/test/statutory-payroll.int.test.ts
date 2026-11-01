import { monthsAfterInYear, newId, REFERENCE_RATE_SETS, tdsFor, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StatutoryRatesService } from '../src/modules/billing/statutory-rates.service';
import { newDevice, newPhone, staffToken, startApp, testConfig, World } from './support';

/** Statutory payroll (M14, BR-56 to BR-58, decision D128). */

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
  };
}

const code = (response: { json(): { error?: { code: string } } }) => response.json().error?.code;
const DAY = 86_400_000;
const THIS_MONTH = () => todayIn('Asia/Kolkata').slice(0, 7);
const LAST_MONTH = () =>
  new Date(Date.parse(`${THIS_MONTH()}-01T00:00:00Z`) - DAY).toISOString().slice(0, 7);

/** Every day of a month on the record as worked, so the whole month is paid. */
async function wholeMonth(tenantId: string, userId: string, period: string) {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  await world.database.forTenant(tenantId, async (tx) => {
    for (let day = 1; day <= days; day += 1) {
      const date = `${period}-${String(day).padStart(2, '0')}`;
      await tx.execute(sql`
        insert into cell.shifts (id, tenant_id, user_id, started_at, ended_at, start_point,
          start_accuracy, consent_version)
        values (${newId()}, ${tenantId}, ${userId}, ${`${date}T04:00:00Z`}::timestamptz,
          ${`${date}T12:00:00Z`}::timestamptz,
          ST_SetSRID(ST_MakePoint(77.2167, 28.6315), 4326)::geography, 12, '2026-10')`);
    }
  });
}

/** A tenant with statutory payroll switched on, its admin, and four people paid last month. */
async function tenant(name: string, switchOn = true) {
  const tenantId = await world.tenant(name);
  const headPhone = newPhone();
  const head = await world.user(tenantId, {
    phone: headPhone,
    designation: 'head',
    role: 'tenant_admin',
  });
  const admin = as((await world.signIn(headPhone)).accessToken);
  if (switchOn) {
    const on = await admin.patch('/v1/settings', { modulesOn: ['statutory_payroll'] });
    expect(on.statusCode, on.body).toBe(200);
  }
  const person = async (phone = newPhone()) => {
    const user = await world.user(tenantId, {
      phone,
      designation: 'executive',
      managerId: head.id,
      joiningDate: '2020-01-01',
    });
    return { id: user.id, phone };
  };
  return { tenantId, admin, person };
}

describe('statutory payroll (D128)', () => {
  it('stays off until an admin switches it on', async () => {
    const t = await tenant('Payroll Off Ltd', false);
    expect(code(await t.admin.get(`/v1/pay-runs/${LAST_MONTH()}`))).toBe('MODULE_DISABLED');
    // Settings as everyone reads them list it among the modules off.
    const settings = (await t.admin.patch('/v1/settings', { gpsIntervalSeconds: 120 })).json();
    expect(settings.modulesOff).toContain('statutory_payroll');
  });

  it('runs a month across states, ceilings and TDS, then freezes it on approval', async () => {
    const t = await tenant('Payroll Run Ltd');
    const period = LAST_MONTH();
    const [pune, bengaluru, unplaced, ahmedabad, unpaid] = [
      await t.person(),
      await t.person(),
      await t.person(),
      await t.person(),
      await t.person(),
    ];
    const structure = async (userId: string, body: object) => {
      const saved = await t.admin.put(`/v1/salary-structures/${userId}`, { from: period, ...body });
      expect(saved.statusCode, saved.body).toBe(200);
      return saved.json();
    };
    const profile = async (userId: string, body: object) => {
      const saved = await t.admin.put(`/v1/statutory-profiles/${userId}`, body);
      expect(saved.statusCode, saved.body).toBe(200);
    };
    // Pune: 25,000 with HRA 6,000; wages 19,000, ESI-covered.
    expect(
      (await structure(pune.id, { basic: '15000', hra: '6000', special: '4000' })).changes[0],
    ).toMatchObject({ from: period, wages: '19000.00', gross: '25000.00' });
    await profile(pune.id, { workState: 'MH', uan: '100200300400', panOnFile: true });
    // Bengaluru: 30,000, wages 22,000, above ESI's limit.
    await structure(bengaluru.id, { basic: '22000', hra: '8000' });
    await profile(bengaluru.id, { workState: 'KA', panOnFile: true });
    // No profile: PF by default, no state for PT and no PAN on file.
    await structure(unplaced.id, { basic: '10000' });
    // Ahmedabad: 3,00,000 a month, PF on the ceiling, TDS due.
    await structure(ahmedabad.id, { basic: '150000', hra: '60000', special: '90000' });
    await profile(ahmedabad.id, { workState: 'GJ', panOnFile: true });
    for (const each of [pune, bengaluru, unplaced, ahmedabad, unpaid]) {
      await wholeMonth(t.tenantId, each.id, period);
    }

    const drafted = await t.admin.post('/v1/pay-runs', { period });
    expect(drafted.statusCode, drafted.body).toBe(201);
    const run = drafted.json();
    // A month from 17 September 2026 takes the set with the 25,000 ceiling.
    expect(run).toMatchObject({
      period,
      status: 'draft',
      reviewed: false,
      rateSet: { id: 'reference-2026-09' },
    });
    expect(run.payslips).toHaveLength(4);

    const payslip = async (userId: string) => {
      const answer = await t.admin.get(`/v1/statutory-payslips/${userId}/${period}`);
      expect(answer.statusCode, answer.body).toBe(200);
      return answer.json();
    };
    const month = Number(period.slice(5, 7));
    // PF 12% of 19,000 = 2,280; ESI 142.50 up to 143; Maharashtra PT 200 (300 in February).
    const pt = month === 2 ? 300 : 200;
    // The welfare fund in June and December only: 25 from the employee.
    const lwf = month === 6 || month === 12 ? 25 : 0;
    expect(await payslip(pune.id)).toMatchObject({
      status: 'draft',
      esiCovered: true,
      wages: '19000.00',
      gross: '25000.00',
      deductions: expect.arrayContaining([
        { key: 'pf', amount: '2280.00' },
        { key: 'esi', amount: '143.00' },
        { key: 'pt', amount: `${pt}.00` },
      ]),
      employer: expect.arrayContaining([
        { key: 'eps', amount: '1583.00' },
        { key: 'epf', amount: '697.00' },
        { key: 'esi', amount: '618.00' },
      ]),
      net: (25000 - 2280 - 143 - pt - lwf).toFixed(2),
      profile: { uan: '100200300400' },
      reviewed: false,
    });
    // 22,000 is over ESI's limit: no ESI. Karnataka PT 200, or 300 in February.
    const bengaluruSlip = await payslip(bengaluru.id);
    expect(bengaluruSlip.esiCovered).toBe(false);
    expect(bengaluruSlip.deductions).toEqual(
      expect.arrayContaining([
        { key: 'pf', amount: '2640.00' },
        { key: 'pt', amount: month === 2 ? '300.00' : '200.00' },
      ]),
    );
    expect(bengaluruSlip.deductions.map((line: { key: string }) => line.key)).not.toContain('esi');
    expect((await payslip(unplaced.id)).flags).toEqual(['no_work_state', 'no_pan']);
    // 3,00,000: PF on the 25,000 ceiling; TDS by the year projected from this month, which the
    // rules' own fixtures check (FX-67 to FX-69). A nil line stays off the payslip.
    const expectedTds = tdsFor(
      {
        paidBefore: '0',
        deductedBefore: '0',
        thisMonth: '300000.00',
        monthlyGross: '300000.00',
        monthsAfter: monthsAfterInYear(period),
      },
      REFERENCE_RATE_SETS[1]!.rates.tds,
    ).tds;
    const ahmedabadSlip = await payslip(ahmedabad.id);
    expect(ahmedabadSlip.deductions).toEqual(
      expect.arrayContaining([
        { key: 'pf', amount: '3000.00' },
        ...(expectedTds === '0.00' ? [] : [{ key: 'tds', amount: expectedTds }]),
      ]),
    );
    expect(ahmedabadSlip.flags).toEqual([]);

    // The person sees nothing until the run is approved.
    const own = as((await world.signIn(pune.phone, newDevice())).accessToken);
    expect(code(await own.get(`/v1/statutory-payslips/${pune.id}/${period}`))).toBe('NOT_FOUND');
    expect(code(await own.get(`/v1/statutory-payslips/${bengaluru.id}/${period}`))).toBe(
      'FORBIDDEN',
    );

    // An adjustment before approval lands in the run once worked out again.
    expect(
      (
        await t.admin.post('/v1/pay-adjustments', {
          id: newId(),
          userId: pune.id,
          period,
          kind: 'earning',
          key: 'arrears',
          amount: '1000',
          note: 'September arrears',
        })
      ).statusCode,
    ).toBe(204);
    const again = await t.admin.post(`/v1/pay-runs/${period}/recompute`);
    expect(again.statusCode, again.body).toBe(200);
    expect((await payslip(pune.id)).earnings).toEqual(
      expect.arrayContaining([{ key: 'arrears', amount: '1000.00' }]),
    );

    // Approval at the version seen freezes it.
    expect(
      code(await t.admin.post(`/v1/pay-runs/${period}/approve`, { version: run.version })),
    ).toBe('CONFLICT');
    const approved = await t.admin.post(`/v1/pay-runs/${period}/approve`, {
      version: again.json().version,
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved' });
    expect(code(await t.admin.post(`/v1/pay-runs/${period}/recompute`))).toBe('CONFLICT');
    expect(
      code(await t.admin.put(`/v1/salary-structures/${pune.id}`, { from: period, basic: '1' })),
    ).toBe('VALIDATION');
    expect(
      code(
        await t.admin.post('/v1/pay-adjustments', {
          id: newId(),
          userId: pune.id,
          period,
          kind: 'deduction',
          key: 'advance',
          amount: '500',
          note: 'Advance',
        }),
      ),
    ).toBe('VALIDATION');
    const ownSlip = await own.get(`/v1/statutory-payslips/${pune.id}/${period}`);
    expect(ownSlip.statusCode, ownSlip.body).toBe(200);
    expect(ownSlip.json()).toMatchObject({ status: 'approved', net: expect.any(String) });

    // The register holds the run, a row a person.
    const register = (await t.admin.get(`/v1/reports/pay_register?period=${period}`)).json();
    expect(register.rows).toHaveLength(4);

    // Once a chartered accountant has reviewed the set, the run says so.
    await app.get(StatutoryRatesService).recordReview(null, {
      rateSetId: 'reference-2026-09',
      reviewer: 'A. Example, Chartered Accountant (fictional)',
      reviewedOn: '2026-11-02',
      note: 'Test review',
    });
    expect((await t.admin.get(`/v1/pay-runs/${period}`)).json().reviewed).toBe(true);
  });

  it('keeps the rate sets and reviews in the console, for staff who manage billing', async () => {
    const staff = (token: string) => ({
      get: (url: string) =>
        app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }),
      post: (url: string, payload: object) =>
        app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${token}` } }),
    });
    const support = staff(await staffToken(app, 'support'));
    const admin = staff(await staffToken(app, 'platform_admin'));

    const read = await support.get('/platform/v1/statutory-rates');
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().sets.map((set: { id: string }) => set.id)).toEqual(
      expect.arrayContaining(REFERENCE_RATE_SETS.map((set) => set.id)),
    );
    // A set far ahead, so the months the other tests pay keep the reference sets.
    const later = { ...REFERENCE_RATE_SETS[1]!, id: 'test-2099-04', from: '2099-04-01' };
    expect(code(await support.post('/platform/v1/statutory-rates', later))).toBe('FORBIDDEN');

    const added = await admin.post('/platform/v1/statutory-rates', later);
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json()).toMatchObject({ reference: false });
    // The reference sets stay in force before it; sets are only ever added.
    expect(added.json().sets.map((set: { id: string }) => set.id)).toEqual([
      ...REFERENCE_RATE_SETS.map((set) => set.id),
      'test-2099-04',
    ]);
    expect(code(await admin.post('/platform/v1/statutory-rates', later))).toBe('CONFLICT');
    expect(
      code(
        await admin.post('/platform/v1/statutory-rates', { ...later, id: 'test-bad', rates: {} }),
      ),
    ).toBe('VALIDATION');

    const review = {
      rateSetId: 'test-2099-04',
      reviewer: 'A. Example, Chartered Accountant (fictional)',
      reviewedOn: '2026-11-02',
      note: '',
    };
    expect(
      code(
        await admin.post('/platform/v1/statutory-rates/reviews', {
          ...review,
          rateSetId: 'nowhere',
        }),
      ),
    ).toBe('NOT_FOUND');
    const reviewed = await admin.post('/platform/v1/statutory-rates/reviews', review);
    expect(reviewed.statusCode, reviewed.body).toBe(201);
    expect(
      reviewed.json().sets.find((set: { id: string }) => set.id === 'test-2099-04'),
    ).toMatchObject({
      reviewed: true,
      reviews: [expect.objectContaining({ reviewer: review.reviewer })],
    });
  });
});
