import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { SyncEntity } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import { syncTombstones } from '../../db/schema/sync';
import { Database, type TenantTx } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';

const DAY_MS = 86_400_000;

/**
 * Tombstones (spec 11.3): how a module tells phones to drop rows that are gone, or that no phone
 * should hold any more. Write them in the transaction that removes the rows. A row that is still
 * in a caller's reach is sent again whenever it changes, so a tombstone never hides it for long.
 */
@Injectable()
export class SyncTombstones implements OnModuleInit {
  constructor(
    private readonly database: Database,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
  ) {}

  onModuleInit(): void {
    this.queues.handle('maintenance', 'sync.purge_tombstones', () => this.purge());
    this.schedules.every({
      id: 'sync_tombstones_purge',
      everyMs: DAY_MS,
      queue: 'maintenance',
      kind: 'sync.purge_tombstones',
    });
  }

  async record(
    tx: TenantTx,
    tenantId: string,
    entity: SyncEntity,
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    await tx
      .insert(syncTombstones)
      .values(ids.map((entityId) => ({ tenantId, entity, entityId })))
      .onConflictDoUpdate({
        target: [syncTombstones.tenantId, syncTombstones.entity, syncTombstones.entityId],
        set: { rowVersion: sql`excluded.row_version`, createdAt: sql`excluded.created_at` },
      });
  }

  /** Drops tombstones older than 35 days, across every tenant of the cell. */
  async purge(): Promise<void> {
    await this.database.db.execute(sql`select cell.purge_sync_tombstones()`);
  }
}
