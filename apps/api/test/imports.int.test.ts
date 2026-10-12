import { newId } from '@kshetra/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportsService } from '../src/modules/imports/imports.service';
import { xlsx } from '../src/modules/imports/xlsx.test-support';
import { Queues } from '../src/platform/queues';
import { newPhone, startApp, testConfig, World } from './support';

/** Imports (M19, Appendix B.1, BR-42, BR-43) and territories (M4), on real PostgreSQL. */

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

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
    upload: (target: string, fileName: string, body: Uint8Array | string, type = 'text/csv') =>
      app.inject({
        method: 'POST',
        url: `/v1/imports?target=${target}&fileName=${encodeURIComponent(fileName)}`,
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': newId(),
          'content-type': type,
        },
        payload: typeof body === 'string' ? body : Buffer.from(body),
      }),
  };
}

const csv = (rows: (string | number)[][]) =>
  rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

/** A tenant with an admin who may import, and two territories. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  const admin = await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  const north = await world.territory(tenantId, 'NORTH');
  const delhi = await world.territory(tenantId, 'N-DEL', north);
  const token = (await world.signIn(phone)).accessToken;
  return { tenantId, admin, north, delhi, api: as(token) };
}

/** Runs the worker's steps for one import, as the worker would, and returns where it got to. */
async function work(t: Awaited<ReturnType<typeof tenant>>, id: string) {
  const imports = app.get(ImportsService);
  await imports.read(t.tenantId, id);
  await imports.check(t.tenantId, id);
  await imports.write(t.tenantId, id);
  return (await t.api.get(`/v1/imports/${id}`)).json();
}

/** Uploads, reads, confirms the suggested mapping, checks and, when ready, commits. */
async function importFile(
  t: Awaited<ReturnType<typeof tenant>>,
  target: string,
  body: Uint8Array | string,
  fileName = 'people.csv',
  type = 'text/csv',
) {
  const uploaded = await t.api.upload(target, fileName, body, type);
  expect(uploaded.statusCode).toBe(201);
  const id = uploaded.json().id as string;
  const imports = app.get(ImportsService);
  await imports.read(t.tenantId, id);
  const read = (await t.api.get(`/v1/imports/${id}`)).json();
  expect(read.status).toBe('mapping');
  expect((await t.api.put(`/v1/imports/${id}/mapping`, { mapping: read.mapping })).statusCode).toBe(
    200,
  );
  await imports.check(t.tenantId, id);
  const checked = (await t.api.get(`/v1/imports/${id}`)).json();
  if (checked.status !== 'ready') return checked;
  expect((await t.api.post(`/v1/imports/${id}/commit`)).json().status).toBe('committing');
  await imports.write(t.tenantId, id);
  return (await t.api.get(`/v1/imports/${id}`)).json();
}

const HEADER = [
  'Employee code',
  'Name',
  'Mobile',
  'Designation',
  'Reports to',
  'Territory codes',
  'Joining date',
];

describe('importing people (Appendix B.1)', () => {
  it('adds everyone, managers before reports, by code or by name', async () => {
    const t = await tenant('Import Industries');
    const managerPhone = newPhone();
    const done = await importFile(
      t,
      'users',
      csv([
        HEADER,
        // A report before her manager: the commit orders them.
        [
          'IMP-2',
          'Sita Field',
          newPhone().slice(3),
          'executive',
          'Mohan Mehra',
          'N-DEL',
          '01-04-2026',
        ],
        ['IMP-1', 'Mohan Mehra', managerPhone, 'Manager', t.admin.code, 'NORTH', '2026-03-15'],
        ['IMP-3', 'Gita Field', '', 'executive', 'IMP-1', '', ''],
      ]),
    );
    expect(done).toMatchObject({ status: 'committed', created: 3, updated: 0, totalRows: 3 });
    const people = (await t.api.get('/v1/users?q=IMP')).json().items as {
      code: string;
      manager: { code: string } | null;
      territories: { code: string }[];
      joiningDate: string | null;
      phone: string | null;
    }[];
    const byCode = Object.fromEntries(people.map((person) => [person.code, person]));
    expect(byCode['IMP-1']).toMatchObject({
      manager: { code: t.admin.code },
      territories: [{ code: 'NORTH' }],
      joiningDate: '2026-03-15',
      phone: managerPhone,
    });
    expect(byCode['IMP-2']).toMatchObject({
      manager: { code: 'IMP-1' },
      territories: [{ code: 'N-DEL' }],
      joiningDate: '2026-04-01',
    });
    expect(byCode['IMP-3']).toMatchObject({ manager: { code: 'IMP-1' }, phone: null });
  });

  it('updates people by code when the same file comes again, adding nobody twice', async () => {
    const t = await tenant('Reimport Retail');
    const rows = [HEADER, ['RE-1', 'Ravi Repeat', '', 'manager', '-', '', '']];
    expect(await importFile(t, 'users', csv(rows))).toMatchObject({ created: 1, updated: 0 });
    expect(await importFile(t, 'users', csv(rows))).toMatchObject({ created: 0, updated: 0 });
    rows[1]![1] = 'Ravi Renamed';
    expect(await importFile(t, 'users', csv(rows))).toMatchObject({ created: 0, updated: 1 });
    const found = (await t.api.get('/v1/users?q=RE-1')).json().items;
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('Ravi Renamed');
  });

  it('refuses the whole file, row by row, for a loop, a repeated code or an unclear name', async () => {
    const t = await tenant('Refusing Rubber');
    await world.user(t.tenantId, { code: 'OLD-1', name: 'Asha Verma', managerId: t.admin.id });
    await world.user(t.tenantId, { code: 'OLD-2', name: 'Anil Verma', managerId: t.admin.id });
    const checked = await importFile(
      t,
      'users',
      csv([
        HEADER,
        ['LOOP-1', 'Loop One', '', 'manager', 'LOOP-2', '', ''],
        ['LOOP-2', 'Loop Two', '', 'manager', 'LOOP-1', '', ''],
        ['TWICE', 'First Twice', '', 'executive', '', '', ''],
        ['TWICE', 'Second Twice', '', 'executive', '', '', ''],
        ['FX-32', 'Unclear Report', '', 'executive', 'A Verma', 'NOWHERE', 'yesterday'],
      ]),
    );
    expect(checked.status).toBe('invalid');
    expect(checked.errorRows).toBe(5);
    expect(checked.errors).toEqual(
      expect.arrayContaining([
        { row: 2, field: 'reports_to', issue: 'This would make a reporting loop' },
        { row: 3, field: 'reports_to', issue: 'This would make a reporting loop' },
        { row: 4, field: 'code', issue: 'This code appears more than once, in rows 4, 5' },
        {
          row: 6,
          field: 'reports_to',
          issue: 'A Verma could be Asha Verma (OLD-1) or Anil Verma (OLD-2); write the code',
        },
        {
          row: 6,
          field: 'territory_codes',
          issue: 'There is no active territory with the code NOWHERE',
        },
        { row: 6, field: 'joining_date', issue: 'Write a date such as 2026-04-01 or 01-04-2026' },
      ]),
    );
    expect(checked.preview[0]).toMatchObject({
      row: 2,
      values: { code: 'LOOP-1', reports_to: 'LOOP-2' },
      problems: ['This would make a reporting loop'],
    });
    const id = checked.id as string;
    expect((await t.api.post(`/v1/imports/${id}/commit`)).json().error.code).toBe('CONFLICT');
    expect((await t.api.get('/v1/users?q=LOOP')).json().items).toEqual([]);
  });

  it('reads a workbook whose header sits under a title, on the sheet chosen', async () => {
    const t = await tenant('Workbook Works');
    const book = xlsx({
      Notes: [['Nothing here']],
      Staff: [
        ['Staff list, October'],
        [],
        ['Emp code', 'Full name', 'Designation'],
        ['WB-1', 'Wendy Book', 'Executive'],
      ],
    });
    const uploaded = await t.api.upload('users', 'staff.xlsx', book, XLSX);
    const id = uploaded.json().id as string;
    const imports = app.get(ImportsService);
    await imports.read(t.tenantId, id);
    expect((await t.api.get(`/v1/imports/${id}`)).json()).toMatchObject({
      sheets: ['Notes', 'Staff'],
      sheet: 'Notes',
    });
    await t.api.put(`/v1/imports/${id}/mapping`, { sheet: 'Staff' });
    await imports.read(t.tenantId, id);
    const read = (await t.api.get(`/v1/imports/${id}`)).json();
    expect(read).toMatchObject({
      sheet: 'Staff',
      headerRow: 3,
      headers: ['Emp code', 'Full name', 'Designation'],
      mapping: { 'Emp code': 'code', 'Full name': 'name', Designation: 'designation' },
      totalRows: 1,
    });
    // Leaving out a required field is refused before anything is checked.
    const missing = await t.api.put(`/v1/imports/${id}/mapping`, {
      mapping: { ...read.mapping, 'Full name': null },
      saveAs: 'Staff list',
    });
    expect(missing.json().error.details).toEqual([
      { path: 'mapping', issue: 'Choose a column for `name`' },
    ]);
    await t.api.put(`/v1/imports/${id}/mapping`, { mapping: read.mapping, saveAs: 'Staff list' });
    expect(await work(t, id)).toBeTruthy();
    await t.api.post(`/v1/imports/${id}/commit`);
    expect(await work(t, id)).toMatchObject({ status: 'committed', created: 1 });
  });

  it('runs on the worker from upload to the mapping step', async () => {
    const t = await tenant('Worker Wheat');
    app.get(Queues).startWorkers();
    const uploaded = await t.api.upload('users', 'people.csv', csv([HEADER]));
    const id = uploaded.json().id as string;
    const deadline = Date.now() + 10_000;
    let status = '';
    while (Date.now() < deadline && status !== 'mapping') {
      status = (await t.api.get(`/v1/imports/${id}`)).json().status;
      if (status !== 'mapping') await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(status).toBe('mapping');
  });

  it('is for those who may change people as well as run imports', async () => {
    const t = await tenant('Permission Paper');
    const phone = newPhone();
    const manager = await world.user(t.tenantId, { phone, managerId: t.admin.id });
    void manager;
    const managerApi = as((await world.signIn(phone)).accessToken);
    expect((await managerApi.upload('users', 'p.csv', csv([HEADER]))).json().error.code).toBe(
      'FORBIDDEN',
    );
    // Any other media type is refused before the handler, as VALIDATION (spec 11.4 has no 415).
    const xls = await t.api.upload('users', 'people.xls', 'nonsense', 'application/vnd.ms-excel');
    expect([xls.statusCode, xls.json().error.code]).toEqual([400, 'VALIDATION']);
    expect((await t.api.upload('users', 'people.txt', 'a,b')).json().error.details).toEqual([
      { path: 'fileName', issue: 'Use an .xlsx or .csv file' },
    ]);
  });
});

describe('importing territories', () => {
  it('builds the tree with parents anywhere in the file, and moves a node within its level', async () => {
    const t = await tenant('Territory Tiles');
    const done = await importFile(
      t,
      'territories',
      csv([
        ['Code', 'Name', 'Parent', 'Level'],
        ['S-CHE', 'Chennai', 'SOUTH', ''],
        ['SOUTH', 'South', '', 'Region'],
        ['N-JAI', 'Jaipur', 'NORTH', '2'],
      ]),
      'territories.csv',
    );
    expect(done).toMatchObject({ status: 'committed', created: 3, updated: 0 });
    const tree = (await t.api.get('/v1/territories')).json();
    const byCode = Object.fromEntries(
      tree.items.map((node: { code: string; parentId: string | null; level: number }) => [
        node.code,
        node,
      ]),
    );
    expect(byCode['S-CHE']).toMatchObject({ level: 2, parentId: byCode.SOUTH.id });

    const moved = await importFile(
      t,
      'territories',
      csv([
        ['Code', 'Name', 'Parent'],
        ['N-DEL', 'Delhi', 'SOUTH'],
      ]),
      'move.csv',
    );
    expect(moved).toMatchObject({ status: 'committed', created: 0, updated: 1 });
    const after = (await t.api.get('/v1/territories')).json().items;
    expect(after.find((node: { code: string }) => node.code === 'N-DEL')).toMatchObject({
      name: 'Delhi',
      parentId: byCode.SOUTH.id,
    });

    const wrong = await importFile(
      t,
      'territories',
      csv([
        ['Code', 'Name', 'Parent', 'Level'],
        ['X-1', 'Orphan', 'NOPE', ''],
        ['X-2', 'Too high', 'NORTH', '1'],
      ]),
      'wrong.csv',
    );
    expect(wrong.errors).toEqual([
      { row: 2, field: 'parent_code', issue: 'There is no territory with the code NOPE' },
      { row: 3, field: 'level', issue: 'Under this parent, a territory is level 2' },
    ]);
  });
});

describe('territories (M4)', () => {
  it('are added, renamed, moved within their level, and switched off only when empty', async () => {
    const t = await tenant('Tree Timber');
    const south = (await t.api.post('/v1/territories', { code: 'SOUTH', name: 'South' })).json();
    expect(south).toMatchObject({ level: 1, parentId: null, active: true });
    const chennai = (
      await t.api.post('/v1/territories', { code: 'S-CHE', name: 'Chennai', parentId: south.id })
    ).json();
    expect(chennai.level).toBe(2);
    expect(
      (await t.api.post('/v1/territories', { code: 'SOUTH', name: 'Again' })).json().error.code,
    ).toBe('CONFLICT');

    expect(
      (
        await t.api.patch(`/v1/territories/${t.delhi}`, { name: 'Delhi NCR', parentId: south.id })
      ).json(),
    ).toMatchObject({ name: 'Delhi NCR', parentId: south.id, level: 2 });
    expect(
      (await t.api.patch(`/v1/territories/${chennai.id}`, { parentId: t.delhi })).json().error
        .details,
    ).toEqual([
      { path: 'parentId', issue: 'Choose a parent at the same level as the current one' },
    ]);

    expect(
      (await t.api.patch(`/v1/territories/${south.id}`, { active: false })).json().error.code,
    ).toBe('CONFLICT');
    await world.attach(t.tenantId, t.admin.id, chennai.id);
    expect(
      (await t.api.patch(`/v1/territories/${chennai.id}`, { active: false })).json().error.details,
    ).toEqual([{ path: 'active', issue: 'People work in this territory' }]);
  });
});
