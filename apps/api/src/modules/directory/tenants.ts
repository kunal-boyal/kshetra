import { Injectable } from '@nestjs/common';
import { AppError, newId, OPEN_TENANT_STATUSES, type TenantStatus } from '@thelamp/shared';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { cells, tenants } from '../../db/schema/directory';
import { type CellEntry, TenantDirectory, type TenantStanding } from '../../platform/planes';
import { DirectoryDatabase } from './directory.database';
import { PlatformAudit } from './platform-audit';

export interface NewTenant {
  id: string;
  slug: string;
  name: string;
  cellName: string;
  templateKey: string;
  templateVersion: number;
  /** A tenant for showing the product, whose people may sign in with demo codes (D70). */
  demo?: boolean;
  /** When its trial ends, for a tenant that opens on one (decision D88). */
  trialEndsAt?: Date;
}

/** The tenant registry and cells (spec 9.3, 10.3). */
@Injectable()
export class DirectoryTenants extends TenantDirectory {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly audit: PlatformAudit,
  ) {
    super();
  }

  async status(tenantId: string): Promise<TenantStatus | undefined> {
    const [tenant] = await this.database.db
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return tenant?.status;
  }

  async standing(tenantId: string): Promise<TenantStanding | undefined> {
    const [tenant] = await this.database.db
      .select({ status: tenants.status, cell: cells.name, movingToCellId: tenants.movingToCellId })
      .from(tenants)
      .innerJoin(cells, eq(cells.id, tenants.cellId))
      .where(eq(tenants.id, tenantId));
    if (!tenant) return undefined;
    const movingTo = tenant.movingToCellId ? await this.cellName(tenant.movingToCellId) : null;
    return { status: tenant.status, cell: tenant.cell, moving: movingTo !== null, movingTo };
  }

  private async cellName(id: string): Promise<string | null> {
    const [cell] = await this.database.db
      .select({ name: cells.name })
      .from(cells)
      .where(eq(cells.id, id));
    return cell?.name ?? null;
  }

  async startMove(tenantId: string, toCell: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [tenant] = await tx
        .select({ cellId: tenants.cellId, movingTo: tenants.movingToCellId })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for('update');
      if (!tenant) throw new AppError('NOT_FOUND', 'There is no such tenant.');
      const [target] = await tx.select({ id: cells.id }).from(cells).where(eq(cells.name, toCell));
      if (!target) {
        throw new AppError('NOT_FOUND', `There is no cell ${toCell}; register it first.`);
      }
      if (target.id === tenant.cellId) {
        throw new AppError('CONFLICT', 'The tenant lives on that cell already.');
      }
      if (tenant.movingTo) throw new AppError('CONFLICT', 'The tenant is being moved already.');
      await tx.update(tenants).set({ movingToCellId: target.id }).where(eq(tenants.id, tenantId));
      await this.audit.record(tx, null, 'tenant.move_started', 'tenant', tenantId, {
        to: toCell,
      });
    });
  }

  async finishMove(tenantId: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [tenant] = await tx
        .select({ cellId: tenants.cellId, movingTo: tenants.movingToCellId })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for('update');
      if (!tenant?.movingTo) throw new AppError('CONFLICT', 'The tenant is not being moved.');
      await tx
        .update(tenants)
        .set({ cellId: tenant.movingTo, movingToCellId: null })
        .where(eq(tenants.id, tenantId));
      await this.audit.record(tx, null, 'tenant.moved', 'tenant', tenantId, {
        from: await this.cellName(tenant.cellId),
        to: await this.cellName(tenant.movingTo),
      });
    });
  }

  async cancelMove(tenantId: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [tenant] = await tx
        .update(tenants)
        .set({ movingToCellId: null })
        .where(and(eq(tenants.id, tenantId), isNotNull(tenants.movingToCellId)))
        .returning({ id: tenants.id });
      if (!tenant) throw new AppError('CONFLICT', 'The tenant is not being moved.');
      await this.audit.record(tx, null, 'tenant.move_cancelled', 'tenant', tenantId, {});
    });
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

  async tenantsOn(cellName: string): Promise<string[]> {
    const rows = await this.database.db
      .select({ id: tenants.id })
      .from(tenants)
      .innerJoin(cells, eq(cells.id, tenants.cellId))
      .where(and(eq(cells.name, cellName), isNull(tenants.deletedAt)))
      .orderBy(tenants.id);
    return rows.map((row) => row.id);
  }

  async openTenants(cellName: string): Promise<string[]> {
    const rows = await this.database.db
      .select({ id: tenants.id })
      .from(tenants)
      .innerJoin(cells, eq(cells.id, tenants.cellId))
      .where(
        and(
          eq(cells.name, cellName),
          inArray(tenants.status, [...OPEN_TENANT_STATUSES]),
          // A tenant being moved does no scheduled work until it lands (decision D95).
          isNull(tenants.movingToCellId),
        ),
      )
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
  ): Promise<{ id: string; status: TenantStatus; demo: boolean; templateKey: string } | undefined> {
    const [tenant] = await this.database.db
      .select({
        id: tenants.id,
        status: tenants.status,
        demo: tenants.demo,
        templateKey: tenants.templateKey,
      })
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
        trialEndsAt: tenant.trialEndsAt ?? null,
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
