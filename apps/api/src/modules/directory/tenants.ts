import { Injectable } from '@nestjs/common';
import { AppError, newId, type TenantStatus } from '@kshetra/shared';
import { eq } from 'drizzle-orm';
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

  async bySlug(slug: string): Promise<{ id: string; status: TenantStatus } | undefined> {
    const [tenant] = await this.database.db
      .select({ id: tenants.id, status: tenants.status })
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
