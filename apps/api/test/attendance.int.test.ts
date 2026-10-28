import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportsService } from '../src/modules/imports/imports.service';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Holiday calendars and regularisation (M13, BR-23 to BR-25, BR-28, decision D80). */

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
    upload: (body: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/imports?target=holidays&fileName=holidays.csv',
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': newId(),
          'content-type': 'text/csv',
        },
        payload: body,
      }),
  };
}

const DAY = 86_400_000;
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

/** Last month on the tenant's clock, with its days and the weekdays among them, Sundays apart. */
function lastMonth() {
  const today = todayIn('Asia/Kolkata');
  const period = shift(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const days: string[] = [];
  for (let date = `${period}-01`; date.startsWith(period); date = shift(date, 1)) days.push(date);
  return { period, days, weekdays: days.filter((date) => weekday(date) !== 7) };
}

/** A tenant with its head (the admin), a manager, and a field user reporting to the manager. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { head: newPhone(), manager: newPhone(), field: newPhone() };
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
  return {
    tenantId,
    fieldId: field.id,
    head: as((await world.signIn(phones.head)).accessToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
    field: as((await world.signIn(phones.field, newDevice())).accessToken),
  };
}

type Day = {
  date: string;
  status: string;
  value: number;
  holiday: string | null;
  regularisation: { id: string; status: string; state: string } | null;
};

async function month(api: ReturnType<typeof as>, userId: string, period: string) {
  const answer = await api.get(`/v1/attendance?userId=${userId}&period=${period}`);
  expect(answer.statusCode, answer.body).toBe(200);
  const body = answer.json() as { days: Day[]; summary: { scheduled: number; paid: number } };
  return { ...body, on: (date: string) => body.days.find((day) => day.date === date)! };
}

async function stored(tenantId: string, userId: string, date: string) {
  const result = await world.database.forTenant(tenantId, (tx) =>
    tx.execute<{ status: string }>(
      `select status from cell.attendance_days where user_id = '${userId}' and date = '${date}'`,
    ),
  );
  return result.rows[0]?.status ?? null;
}

describe('holiday calendars (M13, spec 5.10)', () => {
  it('starts from the template’s calendar, and shapes the month with holidays and weekly offs', async () => {
    const t = await tenant('Calendar Co');
    const { period, days, weekdays } = lastMonth();
    const calendars = (await t.head.get(`/v1/calendars?year=${period.slice(0, 4)}`)).json();
    expect(calendars.items).toEqual([
      {
        key: 'standard',
        name: { en: 'Standard', hi: 'सामान्य' },
        weeklyOffs: [7],
        default: true,
        holidays: [],
      },
    ]);

    const [holiday, optional] = weekdays;
    const added = await t.head.put(`/v1/calendars/standard/holidays/${holiday}`, {
      name: 'Founders Day',
    });
    expect(added.statusCode, added.body).toBe(200);
    expect(
      (
        await t.head.put(`/v1/calendars/standard/holidays/${optional}`, {
          name: 'Local fair',
          optional: true,
        })
      ).statusCode,
    ).toBe(200);
    expect(added.json().items[0].holidays).toEqual([
      { date: holiday, name: 'Founders Day', optional: false },
    ]);

    const read = await month(t.head, t.fieldId, period);
    expect(read.on(holiday!)).toMatchObject({
      status: 'holiday',
      value: 0,
      holiday: 'Founders Day',
    });
    // An optional holiday is a working day for anyone who doesn't take leave.
    expect(read.on(optional!)).toMatchObject({ status: 'absent', holiday: null });
    const sundays = days.filter((date) => weekday(date) === 7);
    for (const sunday of sundays) expect(read.on(sunday).status).toBe('weekly_off');
    // BR-24 and BR-25
    expect(read.summary).toEqual({ scheduled: days.length - sundays.length - 1, paid: 0 });
    // The stored day, for reports, follows the calendar.
    expect(await stored(t.tenantId, t.fieldId, holiday!)).toBe('holiday');

    // Taken off the calendar, the day is a working day again.
    const removed = await t.head.put(`/v1/calendars/standard/holidays/${holiday}`, {
      name: 'Founders Day',
      active: false,
    });
    expect(removed.json().items[0].holidays).toEqual([
      { date: optional, name: 'Local fair', optional: true },
    ]);
    expect((await month(t.head, t.fieldId, period)).on(holiday!).status).toBe('absent');
    expect(await stored(t.tenantId, t.fieldId, holiday!)).toBe('absent');

    // Only those who manage calendars change them.
    const refused = await t.manager.put(`/v1/calendars/standard/holidays/${holiday}`, {
      name: 'Founders Day',
    });
    expect(refused.json().error.code).toBe('FORBIDDEN');
    expect(
      (await t.head.put(`/v1/calendars/nowhere/holidays/${holiday}`, { name: 'X' })).json().error
        .code,
    ).toBe('NOT_FOUND');
  });

  it('keeps a person on a calendar that exists, or on the default', async () => {
    const t = await tenant('Person Calendar Co');
    const unknown = await t.head.put(`/v1/users/${t.fieldId}/calendar`, { calendarKey: 'south' });
    expect(unknown.json().error.details).toEqual([
      { path: 'calendarKey', issue: 'There is no calendar with this key' },
    ]);
    const kept = await t.head.put(`/v1/users/${t.fieldId}/calendar`, { calendarKey: 'standard' });
    expect(kept.json()).toEqual({ userId: t.fieldId, calendarKey: 'standard' });
    expect((await t.head.get(`/v1/users/${t.fieldId}`)).json().calendarKey).toBe('standard');
    expect(
      (await t.head.put(`/v1/users/${newId()}/calendar`, { calendarKey: null })).json().error.code,
    ).toBe('NOT_FOUND');
  });
});

describe('regularisation (BR-28)', () => {
  it('counts a day as present once its chain approves, one open request a day', async () => {
    const t = await tenant('Regularise Co');
    const { period, weekdays } = lastMonth();
    const [day, other] = weekdays;
    const future = await t.field.post('/v1/regularisations', {
      id: newId(),
      date: shift(todayIn('Asia/Kolkata'), 1),
      status: 'present',
      reason: 'Planned meeting',
    });
    expect(future.json().error.details).toEqual([
      { path: 'date', issue: 'Ask about a day that has passed' },
    ]);

    const request = {
      id: newId(),
      date: day,
      status: 'present',
      reason: 'Met the distributor at the depot all day',
    };
    const asked = await t.field.post('/v1/regularisations', request);
    expect(asked.statusCode, asked.body).toBe(201);
    expect(asked.json()).toMatchObject({
      id: request.id,
      state: 'pending',
      approval: {
        requestType: 'regularisation',
        status: 'pending',
        subject: { title: day, detail: 'Met the distributor at the depot all day' },
      },
    });
    // Sent again, the same request answers the same.
    expect((await t.field.post('/v1/regularisations', request)).json().id).toBe(request.id);
    const again = await t.field.post('/v1/regularisations', { ...request, id: newId() });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('CONFLICT');

    // Waiting, the day stays as it was, showing the request.
    let read = await month(t.manager, t.fieldId, period);
    expect(read.on(day!)).toMatchObject({
      status: 'absent',
      regularisation: { id: request.id, status: 'present', state: 'pending' },
    });

    // The chain: the reporting manager, then the head.
    let approval = asked.json().approval;
    const first = await t.manager.post(`/v1/approvals/${approval.id}/decision`, {
      decision: 'approve',
      version: approval.version,
    });
    expect(first.json().status).toBe('pending');
    approval = first.json();
    const last = await t.head.post(`/v1/approvals/${approval.id}/decision`, {
      decision: 'approve',
      version: approval.version,
    });
    expect(last.json().status).toBe('approved');

    read = await month(t.field, t.fieldId, period);
    expect(read.on(day!)).toMatchObject({
      status: 'present',
      value: 1,
      regularisation: { state: 'approved' },
    });
    expect(read.summary.paid).toBe(1);
    expect(await stored(t.tenantId, t.fieldId, day!)).toBe('present');
    // An approved day takes no second request.
    expect(
      (await t.field.post('/v1/regularisations', { ...request, id: newId() })).statusCode,
    ).toBe(409);

    // A rejected request frees its day for another.
    const half = await t.field.post('/v1/regularisations', {
      id: newId(),
      date: other,
      status: 'half_day',
      reason: 'Left early for the clinic',
    });
    const halfApproval = half.json().approval;
    const rejected = await t.manager.post(`/v1/approvals/${halfApproval.id}/decision`, {
      decision: 'reject',
      version: halfApproval.version,
      note: 'No visit that day',
    });
    expect(rejected.json().status).toBe('rejected');
    expect(
      (
        await t.field.post('/v1/regularisations', {
          id: newId(),
          date: other,
          status: 'half_day',
          reason: 'Left early for the clinic, with a note',
        })
      ).statusCode,
    ).toBe(201);

    const listed = (
      await t.manager.get(`/v1/regularisations?userId=${t.fieldId}&period=${period}`)
    ).json();
    expect(listed.items.map((item: { state: string }) => item.state)).toEqual([
      'approved',
      'rejected',
      'pending',
    ]);
    expect((await t.field.get(`/v1/regularisations?period=${period}`)).json().items).toHaveLength(
      3,
    );
  });
});

describe('the attendance register (decision D104)', () => {
  type Row = {
    user: { id: string; name: string };
    days: { date: string; status: string }[];
    present: number;
  };
  const register = async (api: ReturnType<typeof as>, query: string) => {
    const answer = await api.get(`/v1/attendance/register?${query}`);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json() as { items: Row[]; nextCursor: string | null };
  };

  it("lists everyone in scope by day, narrowed to a territory's people, a page at a time", async () => {
    const t = await tenant('Register Co');
    const { period, days, weekdays } = lastMonth();
    const outsider = await world.user(t.tenantId, {
      phone: newPhone(),
      designation: 'executive',
      joiningDate: '2020-01-01',
    });
    const north = await world.territory(t.tenantId, 'NORTH');
    await world.attach(t.tenantId, t.fieldId, north);
    // A day fixed as present counts in the total.
    const fixed = weekdays[2]!;
    const asked = await t.field.post('/v1/regularisations', {
      id: newId(),
      date: fixed,
      status: 'present',
      reason: 'Phone was off',
    });
    expect(asked.statusCode, asked.body).toBe(201);
    // The chain: the reporting manager, then the head.
    let approval = asked.json().approval;
    for (const api of [t.manager, t.head]) {
      const decided = await api.post(`/v1/approvals/${approval.id}/decision`, {
        decision: 'approve',
        version: approval.version,
      });
      expect(decided.statusCode, decided.body).toBe(200);
      approval = decided.json();
    }
    expect(approval.status).toBe('approved');

    const all = await register(t.head, `period=${period}`);
    expect(all.items.map((row) => row.user.id)).toEqual(
      expect.arrayContaining([t.fieldId, outsider.id]),
    );
    const theirs = all.items.find((row) => row.user.id === t.fieldId)!;
    expect(theirs.days.map((day) => day.date)).toEqual(days);
    expect(theirs.days.find((day) => day.date === fixed)!.status).toBe('present');
    for (const day of theirs.days.filter((entry) => weekday(entry.date) === 7)) {
      expect(day.status).toBe('weekly_off');
    }
    expect(theirs.present).toBe(1);

    // The manager sees their own team only; someone outside it never appears.
    const team = await register(t.manager, `period=${period}`);
    expect(team.items.map((row) => row.user.id)).toContain(t.fieldId);
    expect(team.items.map((row) => row.user.id)).not.toContain(outsider.id);

    // A territory takes in the people attached under it in the month.
    const narrowed = await register(t.head, `period=${period}&territoryId=${north}`);
    expect(narrowed.items.map((row) => row.user.id)).toEqual([t.fieldId]);

    // A page at a time.
    const first = await register(t.head, `period=${period}&limit=1`);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe('1');
    const second = await register(t.head, `period=${period}&limit=1&cursor=1`);
    expect(second.items[0]!.user.id).not.toBe(first.items[0]!.user.id);

    // Someone who sees no one else's work is refused.
    expect((await t.field.get(`/v1/attendance/register?period=${period}`)).json().error.code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('holiday imports (Appendix B.7)', () => {
  it('finds calendars by key or name, refuses a day twice, and loads the rest', async () => {
    const t = await tenant('Holiday Import Co');
    const year = Number(todayIn('Asia/Kolkata').slice(0, 4)) + 1;
    const run = async (csv: string) => {
      const uploaded = await t.head.upload(csv);
      expect(uploaded.statusCode, uploaded.body).toBe(201);
      const id = uploaded.json().id as string;
      const imports = app.get(ImportsService);
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
      [
        'Calendar,Date,Holiday,Optional',
        `Standard,15-08-${year},Independence Day,No`,
        `standard,${year}-08-15,Independence Day again,`,
        `South,${year}-10-02,Gandhi Jayanti,`,
        `standard,${year}-11-05,Guru Nanak Jayanti,perhaps`,
      ].join('\n'),
    );
    expect(refused.status).toBe('invalid');
    expect(
      refused.errors.map((error: { row: number; field: string | null }) => [
        error.row,
        error.field,
      ]),
    ).toEqual([
      [3, 'date'],
      [4, 'calendar'],
      [5, 'optional'],
    ]);
    const loaded = await run(
      [
        'Calendar,Date,Holiday,Optional',
        `Standard,15-08-${year},Independence Day,No`,
        `standard,${year}-11-05,Guru Nanak Jayanti,Yes`,
      ].join('\n'),
    );
    expect(loaded).toMatchObject({ status: 'committed', created: 2 });
    expect((await t.head.get(`/v1/calendars?year=${year}`)).json().items[0].holidays).toEqual([
      { date: `${year}-08-15`, name: 'Independence Day', optional: false },
      { date: `${year}-11-05`, name: 'Guru Nanak Jayanti', optional: true },
    ]);
  });
});
