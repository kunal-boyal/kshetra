import type { INestApplicationContext } from '@nestjs/common';
import { CreateUserBody, newId } from '@kshetra/shared';
import { loadTemplate } from '@kshetra/templates';
import type { Config } from '../config';
import { isLocalDatabase } from './bootstrap';
import { AccountTypesService } from '../modules/accounts/account-types.service';
import { AccountsService } from '../modules/accounts/accounts.service';
import { CatalogueService } from '../modules/catalogue/catalogue.service';
import { AttendanceService } from '../modules/field/attendance.service';
import { FormsService } from '../modules/forms/forms.service';
import { SYSTEM } from '../modules/iam/actor';
import { People } from '../modules/iam/people';
import { UsersService } from '../modules/iam/users.service';
import { DirectoryTenants } from '../modules/directory/tenants';
import { MetricsService } from '../modules/metrics/metrics.service';
import { TenantProvisioner } from '../modules/provisioning/provisioner';
import { TerritoriesService } from '../modules/territories/territories.service';
import { TenantConfigService } from '../modules/tenant-config/tenant-config.service';
import { AccessResolver } from '../platform/auth';
import { Database } from '../platform/database';
import { CONFIG } from '../platform/tokens';

/**
 * Two fictional tenants on different templates, for local work and CI (spec 9.4, phase 0 exit
 * criteria). Every name, number and place is made up. One person belongs to both tenants, so
 * choosing a tenant after the code can be tried.
 */

interface SeedPerson {
  code: string;
  name: string;
  phone: string;
  designation: string;
  role?: string;
  manager?: string;
  territories?: string[];
}

interface SeedAccount {
  code?: string;
  name: string;
  type: string;
  territory: string;
  /** Who fills each slot, by employee code. */
  slots: Record<string, string>;
  parent?: string;
  location?: { lat: number; lng: number };
  custom?: Record<string, unknown>;
}

interface SeedTenant {
  name: string;
  slug: string;
  template: string;
  admin: { code: string; name: string; phone: string };
  territories: { code: string; name: string; parent?: string }[];
  people: SeedPerson[];
  accounts: SeedAccount[];
}

export const SEED: readonly SeedTenant[] = [
  {
    name: 'Sunrise Traders',
    slug: 'sunrise',
    template: 'generic',
    admin: { code: 'SUN-001', name: 'Anita Rao', phone: '+919000000001' },
    territories: [
      { code: 'N', name: 'North Region' },
      { code: 'N-DEL', name: 'Delhi Area', parent: 'N' },
      { code: 'N-JAI', name: 'Jaipur Area', parent: 'N' },
    ],
    people: [
      { code: 'SUN-002', name: 'Vikram Mehta', phone: '+919000000002', designation: 'head' },
      {
        code: 'SUN-003',
        name: 'Priya Nair',
        phone: '+919000000003',
        designation: 'manager',
        manager: 'SUN-002',
        territories: ['N'],
      },
      {
        code: 'SUN-004',
        name: 'Rahul Verma',
        phone: '+919000000004',
        designation: 'executive',
        manager: 'SUN-003',
        territories: ['N-DEL'],
      },
      {
        code: 'SUN-005',
        name: 'Sneha Kulkarni',
        phone: '+919000000005',
        designation: 'executive',
        manager: 'SUN-003',
        territories: ['N-JAI'],
      },
    ],
    accounts: [
      {
        code: 'CUST-001',
        name: 'Gupta General Store',
        type: 'customer',
        territory: 'N-DEL',
        slots: { executive: 'SUN-004', manager: 'SUN-003' },
        location: { lat: 28.6448, lng: 77.2167 },
      },
      {
        code: 'CUST-002',
        name: 'Sharma Kirana',
        type: 'customer',
        territory: 'N-DEL',
        slots: { executive: 'SUN-004' },
      },
      {
        code: 'CUST-003',
        name: 'Jain Provision Mart',
        type: 'customer',
        territory: 'N-JAI',
        slots: { executive: 'SUN-005', manager: 'SUN-003' },
        location: { lat: 26.9124, lng: 75.7873 },
      },
    ],
  },
  {
    name: 'Harit Agri Inputs',
    slug: 'harit',
    template: 'agri',
    admin: { code: 'HAR-001', name: 'Kavita Joshi', phone: '+919000000011' },
    territories: [
      { code: 'W', name: 'West Zone' },
      { code: 'W-MH', name: 'Maharashtra Region', parent: 'W' },
      { code: 'W-MH-PUN', name: 'Pune Territory', parent: 'W-MH' },
      { code: 'W-MH-PUN-HDP', name: 'Hadapsar Market', parent: 'W-MH-PUN' },
      { code: 'W-MH-PUN-BRM', name: 'Baramati Market', parent: 'W-MH-PUN' },
    ],
    people: [
      {
        code: 'HAR-002',
        name: 'Suresh Patil',
        phone: '+919000000012',
        designation: 'business_head',
      },
      {
        code: 'HAR-003',
        name: 'Imran Shaikh',
        phone: '+919000000013',
        designation: 'asm',
        manager: 'HAR-002',
        territories: ['W-MH'],
      },
      {
        code: 'HAR-004',
        name: 'Deepa Iyer',
        phone: '+919000000014',
        designation: 'tm',
        manager: 'HAR-003',
        territories: ['W-MH-PUN'],
      },
      {
        code: 'HAR-005',
        name: 'Arjun Yadav',
        phone: '+919000000015',
        designation: 'sme',
        manager: 'HAR-004',
        territories: ['W-MH-PUN-HDP'],
      },
      {
        code: 'HAR-006',
        name: 'Meera Pillai',
        phone: '+919000000016',
        designation: 'sme',
        manager: 'HAR-004',
        territories: ['W-MH-PUN-BRM'],
      },
      // Sunrise's admin also has a seat here, so she chooses a tenant after her code.
      {
        code: 'HAR-007',
        name: 'Anita Rao',
        phone: '+919000000001',
        designation: 'business_head',
        role: 'viewer',
      },
    ],
    accounts: [
      {
        code: 'DIST-001',
        name: 'Krishi Seva Kendra',
        type: 'distributor',
        territory: 'W-MH-PUN-HDP',
        slots: { asm: 'HAR-003', tm_so: 'HAR-004', sme: 'HAR-005' },
        location: { lat: 18.5089, lng: 73.926 },
        custom: { annual_revenue: '850000.00' },
      },
      {
        code: 'DIST-002',
        name: 'Baramati Agro Agencies',
        type: 'distributor',
        territory: 'W-MH-PUN-BRM',
        slots: { asm: 'HAR-003', sme: 'HAR-006' },
        custom: { annual_revenue: '320000.00' },
      },
      {
        name: 'Shree Krishi Bhandar',
        type: 'retailer',
        territory: 'W-MH-PUN-HDP',
        parent: 'DIST-001',
        slots: { sme: 'HAR-005' },
      },
    ],
  },
];

/** The seed refuses production, and any database that isn't on this machine (spec 0, rule 7). */
export function assertSeedable(config: Config): void {
  if (config.NODE_ENV === 'production') throw new Error('The seed never runs in production.');
  for (const url of [config.DATABASE_URL, config.DIRECTORY_DATABASE_URL]) {
    if (!isLocalDatabase(url)) {
      throw new Error(
        `The seed only runs against a database on this machine, not ${new URL(url).hostname}.`,
      );
    }
  }
}

export interface SeededPerson {
  tenant: string;
  name: string;
  phone: string;
  role: string;
  designation: string;
}

export interface SeedReport {
  created: string[];
  existed: string[];
  people: SeededPerson[];
}

/** Creates the seed tenants that don't exist yet; running it again changes nothing. */
export async function seed(app: INestApplicationContext): Promise<SeedReport> {
  const report: SeedReport = { created: [], existed: [], people: [] };
  const database = app.get(Database);
  const users = app.get(UsersService);
  const territories = app.get(TerritoriesService);

  for (const tenant of SEED) {
    const existing = await app.get(DirectoryTenants).bySlug(tenant.slug);
    if (existing) {
      // Tenants seeded before accounts arrived (phase 1 step 5) catch up.
      await seedAccounts(app, existing.id, tenant);
      report.existed.push(tenant.slug);
      continue;
    }
    const { tenantId, admin } = await app.get(TenantProvisioner).provision({
      name: tenant.name,
      slug: tenant.slug,
      template: tenant.template,
      status: 'active',
      admin: tenant.admin,
    });
    report.people.push({
      tenant: tenant.slug,
      name: admin.name,
      phone: admin.phone!,
      role: admin.role,
      designation: admin.designation,
    });

    const people = await database.forTenant(tenantId, async (tx) => {
      const nodes = new Map<string, string>();
      for (const node of tenant.territories) {
        const parentId = node.parent ? nodes.get(node.parent)! : null;
        nodes.set(
          node.code,
          await territories.create(
            tx,
            tenantId,
            { code: node.code, name: node.name, parentId },
            null,
          ),
        );
      }
      const ids = new Map<string, string>([[tenant.admin.code, admin.id]]);
      const made: SeededPerson[] = [];
      for (const person of tenant.people) {
        const user = await users.create(
          tx,
          tenantId,
          SYSTEM,
          CreateUserBody.parse({
            code: person.code,
            name: person.name,
            phone: person.phone,
            designation: person.designation,
            ...(person.role ? { role: person.role } : {}),
            managerId: person.manager ? ids.get(person.manager)! : null,
            joiningDate: '2026-04-01',
          }),
        );
        ids.set(person.code, user.id);
        for (const code of person.territories ?? []) {
          await territories.attach(tx, tenantId, user.id, nodes.get(code)!, '2026-04-01');
        }
        made.push({
          tenant: tenant.slug,
          name: user.name,
          phone: user.phone!,
          role: user.role,
          designation: user.designation,
        });
      }
      return made;
    });
    report.people.push(...people);
    await seedAccounts(app, tenantId, tenant);
    report.created.push(tenant.slug);
  }
  return report;
}

/**
 * The tenant's account types, catalogue settings and forms, if it has none yet, and its seed
 * accounts that don't exist yet, made as its admin would make them. Running it again changes
 * nothing.
 */
async function seedAccounts(
  app: INestApplicationContext,
  tenantId: string,
  tenant: SeedTenant,
): Promise<void> {
  const database = app.get(Database);
  const types = app.get(AccountTypesService);
  const accounts = app.get(AccountsService);
  const people = app.get(People);
  const adminId = await database.forTenant(tenantId, async (tx) => {
    // Parts a template gained after the tenant was seeded (phase 1 steps 5 and 7).
    const template = loadTemplate(tenant.template);
    let added = false;
    if ((await types.list(tx, tenantId)).length === 0) {
      await types.applyTemplate(tx, tenantId, template.accountTypes);
      added = true;
    }
    if ((await app.get(CatalogueService).version(tx, tenantId)) === 0) {
      await app.get(CatalogueService).applyTemplate(tx, tenantId, template.catalogue);
    }
    // Metrics arrived with targets (phase 1 step 11c); storing them again changes nothing.
    await app.get(MetricsService).applyTemplate(tx, tenantId, template.metrics, template.score);
    if ((await app.get(FormsService).list(tx, tenantId)).length === 0) {
      await app.get(FormsService).applyTemplate(tx, tenantId, template.forms);
      added = true;
    }
    // The attendance rule (phase 1 step 8); applying it again changes nothing.
    await app.get(AttendanceService).applyTemplate(tx, tenantId, template.people.attendance);
    if (added) await app.get(TenantConfigService).touch(tx, tenantId, null);
    return (await people.everyone(tx, tenantId)).find((person) => person.code === tenant.admin.code)
      ?.id;
  });
  if (!adminId) return;
  const access = await app
    .get(AccessResolver)
    .onBehalfOf(tenantId, adminId, app.get<Config>(CONFIG).CELL_ID);
  await database.forTenant(tenantId, async (tx) => {
    const byCode = new Map((await people.everyone(tx, tenantId)).map((p) => [p.code, p.id]));
    const nodes = new Map(
      (await app.get(TerritoriesService).list(tx, tenantId, {})).map((node) => [
        node.code,
        node.id,
      ]),
    );
    for (const account of tenant.accounts) {
      const all = (await accounts.list(tx, access, { limit: 200 })).items;
      if (all.some((found) => found.name === account.name)) continue;
      const parent = account.parent
        ? all.find((found) => found.code === account.parent)
        : undefined;
      await accounts.create(tx, access, {
        id: newId(),
        type: account.type,
        ...(account.code ? { code: account.code } : {}),
        name: account.name,
        territoryId: nodes.get(account.territory)!,
        ...(parent ? { parentId: parent.id } : {}),
        ...(account.location ? { location: account.location } : {}),
        slots: Object.fromEntries(
          Object.entries(account.slots).map(([slot, code]) => [slot, byCode.get(code)!]),
        ),
        ...(account.custom ? { custom: account.custom } : {}),
      });
    }
  });
}
