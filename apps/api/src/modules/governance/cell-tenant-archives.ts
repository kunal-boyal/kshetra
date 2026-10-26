import { Injectable } from '@nestjs/common';
import type { DataExportResult } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import type { AuditActor } from '../../platform/audit';
import { Database } from '../../platform/database';
import { type StaffActor, TenantArchives } from '../../platform/planes';
import { MediaService } from '../media/media.service';
import { DataExportsService } from './data-exports.service';

/** Vendor staff in the tenant's audit log: a platform actor, as vendor support is. */
const staffActor = (by: StaffActor): AuditActor => ({ kind: 'platform', id: by.staffId });

/**
 * The cell's side of what the console does with a tenant's data (decision D95): exports asked
 * for by vendor staff, and erasing everything the tenant holds here once its 30 days are over.
 */
@Injectable()
export class CellTenantArchives extends TenantArchives {
  constructor(
    private readonly database: Database,
    private readonly exports: DataExportsService,
    private readonly media: MediaService,
  ) {
    super();
  }

  request(tenantId: string, id: string, by: StaffActor): Promise<DataExportResult> {
    return this.database.forTenant(tenantId, (tx) =>
      this.exports.ask(tx, tenantId, id, { userId: null, name: by.name }, staffActor(by)),
    );
  }

  list(tenantId: string): Promise<DataExportResult[]> {
    return this.database.forTenant(tenantId, (tx) => this.exports.list(tx, tenantId));
  }

  read(tenantId: string, id: string, by: StaffActor): Promise<DataExportResult> {
    return this.database.forTenant(tenantId, (tx) =>
      this.exports.read(tx, tenantId, id, staffActor(by)),
    );
  }

  /**
   * Removes every file and row the tenant holds in this cell, the tenant's own audit log among
   * them. Running it again finds nothing left and removes nothing.
   */
  async erase(tenantId: string): Promise<{ rows: number; files: number }> {
    return this.database.forTenant(tenantId, async (tx) => {
      const files = await this.media.removeAllObjects(tx, tenantId);
      const [result] = (await tx.execute(sql`select cell.purge_tenant(${tenantId}) as removed`))
        .rows as { removed: string }[];
      return { rows: Number(result?.removed ?? 0), files };
    });
  }
}
