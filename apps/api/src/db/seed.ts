import type { INestApplicationContext } from '@nestjs/common';
import { CreateUserBody } from '@kshetra/shared';
import type { Config } from '../config';
import { isLocalDatabase } from './bootstrap';
import { SYSTEM } from '../modules/iam/actor';
import { UsersService } from '../modules/iam/users.service';
import { DirectoryTenants } from '../modules/directory/tenants';
import { TenantProvisioner } from '../modules/provisioning/provisioner';
import { TerritoriesService } from '../modules/territories/territories.service';
import { Database } from '../platform/database';

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

interface SeedTenant {
  name: string;
  slug: string;
  template: string;
  admin: { code: string; name: string; phone: string };
  territories: { code: string; name: string; parent?: string }[];
  people: SeedPerson[];
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
    if (await app.get(DirectoryTenants).bySlug(tenant.slug)) {
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
    report.created.push(tenant.slug);
  }
  return report;
}
