import { newId, type ProvisionTenantInput } from '@thelamp/shared';
import { loadTemplate, TEMPLATE_KEYS } from '@thelamp/templates';
import { sql } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, seed } from '../src/db/seed';
import { DirectoryTenants } from '../src/modules/directory/tenants';
import { TenantProvisioner } from '../src/modules/provisioning/provisioner';
import { newAddress, newDevice, newPhone, startApp, World } from './support';

let app: NestFastifyApplication;
let world: World;
let provisioner: TenantProvisioner;

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
  provisioner = app.get(TenantProvisioner);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

const input = (overrides: Partial<ProvisionTenantInput> = {}): ProvisionTenantInput => ({
  name: 'Zenith Agro',
  slug: `zenith-${newId().slice(-8)}`,
  template: 'agri',
  status: 'trial',
  admin: { code: 'ADMIN-1', name: 'Zoya Khan', phone: newPhone() },
  ...overrides,
});

const as = (token: string) => ({
  get: (url: string) =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }),
});

const tenantRow = async (slug: string) =>
  (
    await world.directory.client.query(
      'select id, status, template_key, template_version from directory.tenants where slug = $1',
      [slug],
    )
  ).rows[0];

describe('provisioning a tenant (spec 5.14)', () => {
  it('applies the template, adds the first admin, and opens the tenant once its cell is ready', async () => {
    const request = input();
    const { tenantId, admin } = await provisioner.provision(request);
    expect(await tenantRow(request.slug)).toEqual({
      id: tenantId,
      status: 'trial',
      template_key: 'agri',
      template_version: loadTemplate('agri').version,
    });
    expect(admin).toMatchObject({ role: 'tenant_admin', designation: 'business_head' });

    const owner = as((await world.signIn(request.admin.phone)).accessToken);
    const bundle = (await owner.get('/v1/config')).json();
    expect(bundle.access.role).toBe('tenant_admin');
    expect(bundle.designations).toHaveLength(loadTemplate('agri').designations.length);
    expect(bundle.terminology.en['term.field_user']).toEqual(
      loadTemplate('agri').terminology['term.field_user']!.en,
    );
    // The system made all of it, and the audit log says so.
    const created = (await owner.get(`/v1/audit?targetId=${admin.id}`)).json().items;
    expect(created).toContainEqual(
      expect.objectContaining({ action: 'user.created', actor: { kind: 'system', id: null } }),
    );
  });

  it('refuses a taken slug, an unknown template or a bad number, and writes nothing', async () => {
    const taken = input();
    await provisioner.provision(taken);
    await expect(provisioner.provision(input({ slug: taken.slug }))).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const unknown = input({ template: 'nonexistent' });
    await expect(provisioner.provision(unknown)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [{ path: 'template', issue: 'There is no valid template `nonexistent`' }],
    });
    const badNumber = input({ admin: { code: 'A-1', name: 'Zoya Khan', phone: '12345' } });
    await expect(provisioner.provision(badNumber)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [{ path: 'admin.phone', issue: 'Not a valid mobile number' }],
    });
    expect(await tenantRow(unknown.slug)).toBeUndefined();
    expect(await tenantRow(badNumber.slug)).toBeUndefined();
  });

  it('leaves a tenant closed when its setup fails part-way', async () => {
    const broken = input({ admin: { code: 'not a code!', name: 'Zoya Khan', phone: newPhone() } });
    await expect(provisioner.provision(broken)).rejects.toThrow();
    expect((await tenantRow(broken.slug)).status).toBe('suspended');
    expect(await app.get(DirectoryTenants).bySlug(broken.slug)).toMatchObject({
      status: 'suspended',
    });
  });
});

/**
 * Phase 0's exit criteria (spec 15): a user signs in on a phone and on the web into either of two
 * seeded tenants; the cross-tenant contract test passes (test/cross-tenant.int.test.ts); both
 * templates validate.
 */
describe('the seed and the phase 0 exit check (spec 15)', () => {
  it('validates every template', () => {
    // Phase 0's two, and the industry templates of phase 3 (decision D97).
    expect(TEMPLATE_KEYS).toEqual(['agri', 'fmcg', 'generic', 'pharma']);
    for (const key of TEMPLATE_KEYS) expect(() => loadTemplate(key)).not.toThrow();
  });

  it('seeds two tenants once, and running it again changes nothing', async () => {
    const first = await seed(app);
    expect(first.created.sort()).toEqual(['harit', 'sunrise']);
    const second = await seed(app);
    expect(second).toEqual({ created: [], existed: ['sunrise', 'harit'], people: [] });
    // Each tenant has its template's account types and its fictional accounts, made once.
    for (const tenant of SEED) {
      const tenantId = (await tenantRow(tenant.slug)).id;
      const accounts = await world.database.forTenant(tenantId, (tx) =>
        tx.execute<{ code: string }>(sql`select code from cell.accounts order by code`),
      );
      expect(accounts.rows).toHaveLength(tenant.accounts.length);
    }
  });

  it('lets a person sign in on the web into either seeded tenant, and a field user on a phone', async () => {
    const [sunrise, harit] = SEED;
    const anita = sunrise!.admin.phone;
    const tenants = new Map<string, string>();
    for (const slug of ['sunrise', 'harit']) tenants.set(slug, (await tenantRow(slug)).id);

    for (const slug of ['sunrise', 'harit']) {
      const verified = (await world.verify(anita)).json();
      expect(verified.status).toBe('choose_tenant');
      expect(verified.tenants.map((t: { name: string }) => t.name).sort()).toEqual([
        'Harit Agri Inputs',
        'Sunrise Traders',
      ]);
      const chosen = await app.inject({
        method: 'POST',
        url: '/auth/v1/select-tenant',
        payload: { ticket: verified.ticket, tenantId: tenants.get(slug) },
        remoteAddress: newAddress(),
      });
      // Anita is Sunrise's admin, so her web sign-in there asks for her authenticator (D91).
      const session =
        chosen.json().status === 'second_factor'
          ? (await world.secondFactor(anita, chosen.json())).session
          : chosen.json().session;
      expect(chosen.json().status).toBe(slug === 'sunrise' ? 'second_factor' : 'signed_in');
      const me = (await as(session.accessToken).get('/v1/me')).json();
      expect(me).toMatchObject({
        tenantId: tenants.get(slug),
        name: 'Anita Rao',
        role: slug === 'sunrise' ? 'tenant_admin' : 'viewer',
        deviceId: null,
      });
    }

    const fieldUser = harit!.people.find((person) => person.designation === 'sme')!;
    const onPhone = await world.signIn(fieldUser.phone, newDevice());
    const me = (await as(onPhone.accessToken).get('/v1/me')).json();
    expect(me).toMatchObject({ name: fieldUser.name, role: 'field_user' });
    expect(me.deviceId).toEqual(expect.any(String));
  });
});
