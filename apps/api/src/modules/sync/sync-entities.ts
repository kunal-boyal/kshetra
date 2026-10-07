import { Injectable } from '@nestjs/common';
import type { SyncEntity } from '@kshetra/shared';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';

/** One row of an entity, with the version and ID pages are ordered by. */
export interface SyncRow<Row = unknown> {
  version: number;
  id: string;
  row: Row;
}

export interface SyncRowsPage {
  /** Rows written at or after this horizon; 0 for every row. */
  since: number;
  /** Rows after this one in (version, ID) order; null from the start. */
  after: readonly [number, string] | null;
  limit: number;
}

/**
 * An entity the phones keep a copy of (spec 11.3). The module that owns its table registers it,
 * so the sync module never reads another module's tables.
 */
export interface SyncSource<Row = unknown> {
  name: SyncEntity;
  /** Raise when the row's layout changes: every phone takes a full copy of the entity. */
  version: number;
  /**
   * What decides which rows the caller may hold, such as `tenant`, or a hash of the people their
   * scope reaches. When it changes, rows may have entered or left the caller's reach without
   * changing themselves, so the phone takes a full copy of the entity. At most 64 characters.
   */
  scope(tx: TenantTx, access: Access): Promise<string>;
  /** The rows the caller may hold, in (version, ID) order. */
  rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<Row>[]>;
}

/** Where modules register the entities they own. */
@Injectable()
export class SyncEntities {
  private readonly sources = new Map<SyncEntity, SyncSource>();

  register(source: SyncSource): void {
    if (this.sources.has(source.name)) throw new Error(`${source.name} is registered already.`);
    this.sources.set(source.name, source);
  }

  get(name: SyncEntity): SyncSource {
    const source = this.sources.get(name);
    if (!source) throw new Error(`Nothing provides the ${name} entity.`);
    return source;
  }
}
