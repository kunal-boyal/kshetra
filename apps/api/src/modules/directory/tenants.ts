import { Injectable } from '@nestjs/common';
import { AppError, newId, OPEN_TENANT_STATUSES, type TenantStatus } from '@thelamp/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { cells, tenants } from '../../db/schema/directory';
import { TenantDirectory } from '../../platform/planes';
import { DirectoryDatabase } from './directory.database';

export interface CellEntry {
  name: string;
  region: string;
  apiBaseUrl: string;
  capacityUsers: number;
}

export interface NewTenant {
  id: string;
  slug: string;
  name: string;
  cellName: string;
  templateKey: string;
  templateVersion: number;
  /** A tenant for showing the product, whose people may sign in with demo codes (D70). */
  demo?: boolean;
}

/** The tenant registry and cells (spec 9.3, 10.3). */
@Injectable()
export class DirectoryTenants extends TenantDirectory {
  constructor(private readonly database: DirectoryDatabase) {
    super();
  }

  async status(tenantId: string): Promise<TenantStatus | undefined> {
    const [tenant] = await this.database.db
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return tenant?.status;
  }

  async displayName(tenantId: string): Promise<string | undefined> {
    const [tenant] = await this.database.db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return tenant?.name;
  }

  async rename(tenantId: string, name: string): Promise<void> {
    await this.database.db.update(tenants).set({ name }).where(eq(tenants.id, tenantId));
  }

  async template(tenantId: string): Promise<{ key: string; version: number } | undefined> {
    const [tenant] = await this.database.db
      .select({ key: tenants.templateKey, version: tenants.templateVersion })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return tenant;
  }

  async openTenants(cellName: string): Promise<string[]> {
    const rows = await this.database.db
      .select({ id: tenants.id })
      .from(tenants)
      .innerJoin(cells, eq(cells.id, tenants.cellId))
      .where(and(eq(cells.name, cellName), inArray(tenants.status, [...OPEN_TENANT_STATUSES])))
      .orderBy(tenants.id);
    return rows.map((row) => row.id);
  }

  /** Registers a cell, or keeps the entry it already has. Returns its ID. */
  async ensureCell(cell: CellEntry): Promise<string> {
    await this.database.db
      .insert(cells)
      .values({ id: newId(), ...cell })
      .onConflictDoNothing({ target: cells.name });
    const [row] = await this.database.db
      .select({ id: cells.id })
      .from(cells)
      .where(eq(cells.name, cell.name));
    if (!row) throw new Error(`Cell ${cell.name} could not be registered.`);
    return row.id;
  }

  async bySlug(
    slug: string,
  ): Promise<{ id: string; status: TenantStatus; demo: boolean } | undefined> {
    const [tenant] = await this.database.db
      .select({ id: tenants.id, status: tenants.status, demo: tenants.demo })
      .from(tenants)
      .where(eq(tenants.slug, slug));
    return tenant;
  }

  /**
   * Adds a tenant to the registry, suspended, so nobody signs in to it before it is ready. The
   * `tenant.provisioned` event opens it once its cell has set it up.
   */
  async register(tenant: NewTenant): Promise<void> {
    const [cell] = await this.database.db
      .select({ id: cells.id })
      .from(cells)
      .where(eq(cells.name, tenant.cellName));
    if (!cell) throw new Error(`There is no cell ${tenant.cellName}.`);
    const added = await this.database.db
      .insert(tenants)
      .values({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: 'suspended',
        cellId: cell.id,
        templateKey: tenant.templateKey,
        templateVersion: tenant.templateVersion,
        demo: tenant.demo ?? false,
      })
      .onConflictDoNothing({ target: tenants.slug })
      .returning({ id: tenants.id });
    if (added.length === 0) {
      throw new AppError('CONFLICT', 'Another tenant already has this slug.', [
        { path: 'slug', issue: 'Already used by another tenant' },
      ]);
    }
  }

  async setStatus(tenantId: string, status: TenantStatus): Promise<void> {
    await this.database.db.update(tenants).set({ status }).where(eq(tenants.id, tenantId));
  }
}
