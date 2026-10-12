import { newId, todayIn } from '@kshetra/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountsUpkeep } from '../src/modules/accounts/accounts.upkeep';
import { ImportsService } from '../src/modules/imports/imports.service';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Accounts (spec 5.5, M4), their approvals (D38, BR-31) and import (Appendix B.2). */

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

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

function as(token: string) {
  const call = (method: Method, url: string, payload?: object, key = newId()) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object, key?: string) => call('POST', url, payload, key),
    patch: (url: string, payload: object) => call('PATCH', url, payload),
    put: (url: string, payload: object) => call('PUT', url, payload),
    upload: (target: string, body: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/imports?target=${target}&fileName=accounts.csv`,
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': newId(),
          'content-type': 'text/csv',
        },
        payload: body,
      }),
  };
}

const TODAY = todayIn('Asia/Kolkata');
const TOMORROW = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * An agri tenant: an admin; an ASM over a TM over an SME, each of them signed in; and a market
 * territory. The SME's role sees only their own accounts; the ASM's sees their team's.
 */
async function agri(name: string) {
  const tenantId = await world.tenant(name, 'active', 'agri');
  const zone = await world.territory(tenantId, `Z-${newId().slice(-6)}`);
  const market = await world.territory(tenantId, `M-${newId().slice(-6)}`, zone);
  const phones = { admin: newPhone(), asm: newPhone(), tm: newPhone(), sme: newPhone() };
  const admin = await world.user(tenantId, {
    name: 'Anita Admin',
    phone: phones.admin,
    designation: 'business_head',
    role: 'tenant_admin',
  });
  const asm = await world.user(tenantId, {
    name: 'Arjun Singh',
    phone: phones.asm,
    designation: 'asm',
    managerId: admin.id,
  });
  const tm = await world.user(tenantId, {
    name: 'Tara Mehta',
    phone: phones.tm,
    designation: 'tm',
    managerId: asm.id,
  });
  const sme = await world.user(tenantId, {
    name: 'Suresh Rao',
    phone: phones.sme,
    designation: 'sme',
    managerId: tm.id,
  });
  const token = async (phone: string, device?: ReturnType<typeof newDevice>) =>
    (await world.signIn(phone, device)).accessToken;
  return {
    tenantId,
    zone,
    market,
    admin,
    asm,
    tm,
    sme,
    api: {
      admin: as(await token(phones.admin)),
      asm: as(await token(phones.asm)),
      tm: as(await token(phones.tm)),
      sme: as(await token(phones.sme, newDevice())),
    },
  };
}

type Tenant = Awaited<ReturnType<typeof agri>>;

function distributor(t: Tenant, overrides: Record<string, unknown> = {}) {
  return {
    id: newId(),
    type: 'distributor',
    code: `D-${newId().slice(-8)}`,
    name: 'Green Fields Agro',
    territoryId: t.market,
    slots: { asm: t.asm.id },
    custom: { annual_revenue: '750000.00' },
    ...overrides,
  };
}

describe('accounts (spec 5.5)', () => {
  it('adds an active account with its required slots, its segments and its primary assignee', async () => {
    const t = await agri('Accounts Agro');
    const missing = await t.api.admin.post('/v1/accounts', distributor(t, { slots: {} }));
    expect(missing.json().error.details).toEqual([
      { path: 'slots.asm', issue: 'Choose someone for this slot' },
    ]);
    const wrong = await t.api.admin.post(
      '/v1/accounts',
      distributor(t, { slots: { asm: t.sme.id } }),
    );
    expect(wrong.json().error.details).toEqual([
      { path: 'slots.asm', issue: "This person's designation can't fill this slot" },
    ]);

    const body = distributor(t, { slots: { asm: t.asm.id, sme: t.sme.id } });
    const created = await t.api.admin.post('/v1/accounts', body);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'active',
      segments: ['commercially_active'],
      // The SME slot has the highest priority (1) in the agri template.
      primarySlot: 'sme',
      territory: { id: t.market },
      locationStatus: 'unverified',
    });

    // FX-36: the same ID with the same body returns the first answer; a changed body is refused.
    const again = await t.api.admin.post('/v1/accounts', body);
    expect(again.json()).toEqual(created.json());
    const changed = await t.api.admin.post('/v1/accounts', { ...body, name: 'Changed' });
    expect(changed.json().error.code).toBe('IDEMPOTENCY_CONFLICT');

    const taken = await t.api.admin.post('/v1/accounts', distributor(t, { code: body.code }));
    expect(taken.json().error.code).toBe('CONFLICT');
  });

  it('numbers accounts of a type that numbers them, under a parent of an allowed type', async () => {
    const t = await agri('Numbering Agro');
    const parent = distributor(t);
    await t.api.admin.post('/v1/accounts', parent);
    // The agri template provisions farmers switched off.
    const farmer = await t.api.admin.post('/v1/accounts', {
      id: newId(),
      type: 'farmer',
      name: 'Ramesh Kisan',
      territoryId: t.market,
    });
    expect(farmer.json().error.details).toEqual([
      { path: 'type', issue: 'This type of account is switched off' },
    ]);

    const retailer = (name: string, parentId: string) =>
      t.api.admin.post('/v1/accounts', {
        id: newId(),
        type: 'retailer',
        name,
        territoryId: t.market,
        parentId,
        slots: { sme: t.sme.id },
      });
    const first = await retailer('Village Store', parent.id);
    expect(first.json()).toMatchObject({ code: 'R00001', parent: { id: parent.id } });
    expect((await retailer('Second Store', parent.id)).json().code).toBe('R00002');
    const underRetailer = await retailer('Odd Store', first.json().id);
    expect(underRetailer.json().error.details).toEqual([
      { path: 'parentId', issue: "This type of account can't belong to that one" },
    ]);
  });

  it('shows each person the accounts their scope reaches, and moves them with the slots from their day', async () => {
    const t = await agri('Visibility Agro');
    const mine = distributor(t, { slots: { asm: t.asm.id, sme: t.sme.id } });
    const others = distributor(t, { name: 'Elsewhere Traders' });
    await t.api.admin.post('/v1/accounts', mine);
    await t.api.admin.post('/v1/accounts', others);
    const names = async (api: Tenant['api']['sme']) =>
      ((await api.get('/v1/accounts')).json().items as { name: string }[])
        .map((a) => a.name)
        .sort();

    // The SME sees what they fill; the TM, their team's; the ASM fills both.
    expect(await names(t.api.sme)).toEqual(['Green Fields Agro']);
    expect(await names(t.api.tm)).toEqual(['Green Fields Agro']);
    expect(await names(t.api.asm)).toEqual(['Elsewhere Traders', 'Green Fields Agro']);
    const outside = await t.api.sme.get(`/v1/accounts/${others.id}/overview`);
    expect(outside.json().error.code).toBe('OUT_OF_SCOPE');

    // M4: the slot moves from tomorrow, so today nothing changes...
    const later = await t.api.admin.patch(`/v1/accounts/${others.id}`, {
      slots: { holders: { sme: t.sme.id }, from: TOMORROW },
    });
    expect(later.statusCode).toBe(200);
    expect(await names(t.api.sme)).toEqual(['Green Fields Agro']);
    // ...and from today it moves at once; the history keeps who held it when.
    await t.api.admin.patch(`/v1/accounts/${mine.id}`, { slots: { holders: { sme: null } } });
    expect(await names(t.api.sme)).toEqual([]);
    const overview = (await t.api.admin.get(`/v1/accounts/${others.id}/overview`)).json();
    expect(overview.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot: 'sme',
          user: expect.objectContaining({ id: t.sme.id }),
          validFrom: TOMORROW,
        }),
      ]),
    );
  });

  it('keeps a field user’s accounts on their phone, with today’s slot holders and contacts', async () => {
    const t = await agri('Phone Agro');
    const account = distributor(t, { slots: { asm: t.asm.id, sme: t.sme.id } });
    await t.api.admin.post('/v1/accounts', account);
    await t.api.admin.post('/v1/accounts', distributor(t, { name: 'Not Mine' }));
    const pulled = (await t.api.sme.get('/v1/sync/pull?entities=accounts,contacts')).json();
    expect(pulled.entities.accounts.rows).toEqual([
      expect.objectContaining({
        id: account.id,
        type: 'distributor',
        slots: [
          { slot: 'asm', userId: t.asm.id },
          { slot: 'sme', userId: t.sme.id },
        ],
      }),
    ]);
    expect(pulled.entities.contacts.rows).toEqual([]);
  });
});

describe('proposals from the field (M4, decision D38)', () => {
  it('lets a field user propose an account, which their manager alone decides once', async () => {
    const t = await agri('Proposal Agro');
    // Retailers are added by admins only.
    const refused = await t.api.sme.post('/v1/accounts', {
      id: newId(),
      type: 'retailer',
      name: 'Shop',
      territoryId: t.market,
    });
    expect(refused.json().error.code).toBe('FORBIDDEN');

    const proposal = distributor(t, { slots: undefined });
    const proposed = await t.api.sme.post('/v1/accounts', proposal);
    expect(proposed.statusCode).toBe(201);
    // The proposer fills the slot their designation fits, so the account reaches them.
    expect(proposed.json()).toMatchObject({
      status: 'pending',
      slots: [
        expect.objectContaining({ slot: 'sme', user: expect.objectContaining({ id: t.sme.id }) }),
      ],
      // The required ASM slot waits for an admin, even once approved (decision D43).
      missingSlots: ['asm'],
    });
    expect((await t.api.sme.get('/v1/accounts')).json().items).toHaveLength(1);

    const inbox = (await t.api.tm.get('/v1/approvals/inbox')).json();
    expect(inbox.items).toEqual([
      expect.objectContaining({
        requestType: 'new_account',
        requestId: proposal.id,
        requester: expect.objectContaining({ id: t.sme.id }),
        subject: { title: `Green Fields Agro (${proposal.code})`, accountId: proposal.id },
        version: 1,
      }),
    ]);
    const approval = inbox.items[0];
    expect((await t.api.asm.get('/v1/approvals/inbox')).json().items).toEqual([]);

    // FX-24: someone above the step can't act on it; nobody decides their own request.
    const skipping = await t.api.asm.post(`/v1/approvals/${approval.id}/decision`, {
      decision: 'approve',
      version: 1,
    });
    expect(skipping.json().error.code).toBe('NOT_CURRENT_APPROVER');
    const own = await t.api.sme.post(`/v1/approvals/${approval.id}/decision`, {
      decision: 'approve',
      version: 1,
    });
    expect(own.json().error.code).toBe('FORBIDDEN');
    const vague = await t.api.tm.post(`/v1/approvals/${approval.id}/decision`, {
      decision: 'reject',
      note: 'no',
      version: 1,
    });
    expect(vague.json().error.details).toEqual([
      { path: 'note', issue: 'Say why, in at least 3 characters' },
    ]);

    // FX-25: two decisions at once save one; the other gets 409.
    const [first, second] = await Promise.all([
      t.api.tm.post(`/v1/approvals/${approval.id}/decision`, { decision: 'approve', version: 1 }),
      t.api.tm.post(`/v1/approvals/${approval.id}/decision`, {
        decision: 'reject',
        note: 'Duplicate of another shop',
        version: 1,
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const decided = first.statusCode === 200 ? first.json() : second.json();
    const account = (await t.api.admin.get(`/v1/accounts/${proposal.id}/overview`)).json().account;
    expect(account.status).toBe(decided.status === 'approved' ? 'active' : 'inactive');
    expect((await t.api.tm.get('/v1/approvals/inbox')).json().items).toEqual([]);
  });

  it('takes a location from a fresh fix of 50 m or better, verified once approved', async () => {
    const t = await agri('Location Agro');
    const account = distributor(t, { slots: { asm: t.asm.id, sme: t.sme.id } });
    await t.api.admin.post('/v1/accounts', account);
    const url = `/v1/accounts/${account.id}/location-proposals`;
    const now = new Date().toISOString();
    const fix = { lat: 28.6315, lng: 77.2167, accuracy: 20, capturedAt: now, proposedAt: now };

    const vague = await t.api.sme.post(url, { ...fix, id: newId(), accuracy: 80 });
    expect(vague.json().error.details).toEqual([
      { path: 'accuracy', issue: 'Wait for a fix of 50 m or better' },
    ]);
    const stale = await t.api.sme.post(url, {
      ...fix,
      id: newId(),
      capturedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    // Proposed offline an hour ago, from a fix fresh then: it counts when it arrives.
    const offline = {
      capturedAt: new Date(Date.now() - 61 * 60_000).toISOString(),
      proposedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    };
    expect(stale.json().error.details).toEqual([
      { path: 'capturedAt', issue: 'Take a fresh fix, standing at the account' },
    ]);

    const proposed = await t.api.sme.post(url, { ...fix, ...offline, id: newId() });
    expect(proposed.statusCode).toBe(201);
    expect(proposed.json()).toMatchObject({
      status: 'pending',
      point: { lat: 28.6315, lng: 77.2167 },
    });
    expect((await t.api.sme.post(url, { ...fix, id: newId() })).json().error.code).toBe('CONFLICT');

    const [approval] = (
      await t.api.tm.get('/v1/approvals/inbox?requestType=account_location_change')
    ).json().items;
    expect(approval.subject.accountId).toBe(account.id);
    await t.api.tm.post(`/v1/approvals/${approval.id}/decision`, {
      decision: 'approve',
      version: 1,
    });
    const overview = (await t.api.admin.get(`/v1/accounts/${account.id}/overview`)).json();
    expect(overview.account).toMatchObject({
      location: { lat: 28.6315, lng: 77.2167 },
      locationStatus: 'verified',
    });
    expect(overview.locationProposals[0].status).toBe('approved');
    expect((await t.api.sme.post(url, { ...fix, id: newId() })).json().error.code).toBe('CONFLICT');
  });
});

describe('contacts and account types', () => {
  it('holds contacts only for types that have them, with numbers in one form', async () => {
    const tenantId = await world.tenant('Contact Commerce');
    const phone = newPhone();
    await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
    const executive = await world.user(tenantId, { designation: 'executive' });
    const territory = await world.territory(tenantId, 'C-1');
    const api = as((await world.signIn(phone)).accessToken);
    const account = {
      id: newId(),
      type: 'customer',
      code: 'CUST-1',
      name: 'Corner Mart',
      territoryId: territory,
      slots: { executive: executive.id },
    };
    expect((await api.post('/v1/accounts', account)).statusCode).toBe(201);
    const contactId = newId();
    const added = await api.post(`/v1/accounts/${account.id}/contacts`, {
      id: contactId,
      name: 'Meena Shah',
      role: 'Owner',
      phone: '98765 43210',
    });
    expect(added.json()).toMatchObject({ phone: '+919876543210', active: true });
    const off = await api.patch(`/v1/accounts/${account.id}/contacts/${contactId}`, {
      active: false,
    });
    expect(off.json().active).toBe(false);
    expect((await api.get(`/v1/accounts/${account.id}/overview`)).json().contacts).toHaveLength(1);
  });

  it('publishes a new version of a type, keeping its key and its fields’ types', async () => {
    const t = await agri('Types Agro');
    const types = (await t.api.admin.get('/v1/account-types')).json().items as {
      id: string;
      key: string;
      version: number;
    }[];
    const farmer = types.find((type) => type.key === 'farmer')!;
    const definition = { ...farmer } as Record<string, unknown>;
    delete definition.id;
    delete definition.version;
    const config = (await t.api.admin.get('/v1/config')).json();
    expect(config.accountTypes.map((type: { key: string }) => type.key)).toEqual([
      'distributor',
      'farmer',
      'retailer',
    ]);

    const renamed = await t.api.admin.post(`/v1/account-types/${farmer.id}/versions`, {
      definition: { ...definition, key: 'grower' },
    });
    expect(renamed.json().error.details).toEqual([
      { path: 'definition.key', issue: 'A type keeps its key' },
    ]);
    const fields = (definition.fields as { key: string; label: unknown }[]).map((field) =>
      field.key === 'acreage' ? { key: field.key, type: 'short_text', label: field.label } : field,
    );
    const retyped = await t.api.admin.post(`/v1/account-types/${farmer.id}/versions`, {
      definition: { ...definition, fields },
    });
    expect(retyped.json().error.details).toEqual([
      expect.objectContaining({ issue: '`acreage` was a number field, and a key keeps its type' }),
    ]);
    const published = await t.api.admin.post(`/v1/account-types/${farmer.id}/versions`, {
      definition: { ...definition, contacts: true },
    });
    expect(published.json()).toMatchObject({ key: 'farmer', version: 2, contacts: true });
    expect((await t.api.admin.get('/v1/config')).json().version).toBeGreaterThan(config.version);
  });
});

describe('importing accounts (Appendix B.2)', () => {
  const HEADER = [
    'Distributor code',
    'Name of distributor',
    'Territory code',
    'ASM',
    'SME',
    'Annual revenue',
  ];
  const csv = (rows: string[][]) =>
    rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');

  async function importFile(t: Tenant, body: string) {
    const uploaded = await t.api.admin.upload('accounts:distributor', body);
    expect(uploaded.statusCode).toBe(201);
    const id = uploaded.json().id as string;
    const imports = app.get(ImportsService);
    await imports.read(t.tenantId, id);
    const read = (await t.api.admin.get(`/v1/imports/${id}`)).json();
    expect(read.status).toBe('mapping');
    expect(
      (await t.api.admin.put(`/v1/imports/${id}/mapping`, { mapping: read.mapping })).statusCode,
    ).toBe(200);
    await imports.check(t.tenantId, id);
    const checked = (await t.api.admin.get(`/v1/imports/${id}`)).json();
    if (checked.status !== 'ready') return checked;
    await t.api.admin.post(`/v1/imports/${id}/commit`);
    await imports.write(t.tenantId, id);
    return (await t.api.admin.get(`/v1/imports/${id}`)).json();
  }

  it('maps the template’s headers, matches people by code or name, and updates by code', async () => {
    const t = await agri('Import Agro');
    const market = (await t.api.admin.get('/v1/territories'))
      .json()
      .items.find((node: { id: string }) => node.id === t.market).code as string;
    const rows = [
      HEADER,
      ['D-1', 'Krishi Kendra', market, t.asm.code, 'Suresh Rao', '900000'],
      ['D-2', 'Beej Bhandar', market, 'Arjun Singh', 'No SME', '100000'],
    ];
    const done = await importFile(t, csv(rows));
    expect(done).toMatchObject({ status: 'committed', created: 2, updated: 0 });
    const listed = (await t.api.admin.get('/v1/accounts?type=distributor')).json().items as {
      code: string;
      segments: string[];
      slots: { slot: string }[];
    }[];
    const byCode = Object.fromEntries(listed.map((account) => [account.code, account]));
    expect(byCode['D-1']).toMatchObject({ segments: ['commercially_active'] });
    expect(byCode['D-1']!.slots.map((slot) => slot.slot)).toEqual(['asm', 'sme']);
    expect(byCode['D-2']!.slots.map((slot) => slot.slot)).toEqual(['asm']);

    expect(await importFile(t, csv(rows))).toMatchObject({ created: 0, updated: 0 });
    rows[2]![1] = 'Beej Bhandar & Sons';
    expect(await importFile(t, csv(rows))).toMatchObject({ created: 0, updated: 1 });
  });

  it('fails the whole file, writing nothing, for an unknown parent or an unclear name (M4)', async () => {
    const t = await agri('Refusing Agro');
    await world.user(t.tenantId, { name: 'Sunil Rao', designation: 'sme', managerId: t.tm.id });
    const market = (await t.api.admin.get('/v1/territories'))
      .json()
      .items.find((node: { id: string }) => node.id === t.market).code as string;
    const checked = await importFile(
      t,
      csv([
        HEADER,
        ['D-9', 'Fine Agro', market, t.asm.code, '', ''],
        ['D-10', 'Unclear Agro', market, t.asm.code, 'S Rao', ''],
        ['D-11', 'No Boss Agro', 'NOWHERE', '', '', ''],
      ]),
    );
    expect(checked.status).toBe('invalid');
    const unclear = checked.errors.find(
      (error: { row: number; field: string }) => error.row === 3 && error.field === 'slot.sme',
    );
    expect(unclear.issue).toMatch(
      /^S Rao could be (Suresh|Sunil) Rao .* or (Suresh|Sunil) Rao .*; write the code$/,
    );
    expect(checked.errors).toEqual(
      expect.arrayContaining([
        { row: 4, field: 'territory_code', issue: 'There is no territory with the code NOWHERE' },
        { row: 4, field: 'slot.asm', issue: 'Fill in this slot' },
      ]),
    );
    expect((await t.api.admin.get('/v1/accounts')).json().items).toEqual([]);
  });
});

describe('nightly upkeep', () => {
  it('runs twice without changing anything the second time', async () => {
    const t = await agri('Upkeep Agro');
    await t.api.admin.post('/v1/accounts', distributor(t));
    const upkeep = app.get(AccountsUpkeep);
    await upkeep.run(t.tenantId, TODAY);
    await expect(upkeep.run(t.tenantId, TODAY)).resolves.toBeUndefined();
  });
});
