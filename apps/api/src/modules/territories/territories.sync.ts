import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { SyncTerritory } from '@thelamp/shared';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { territories } from '../../db/schema/territories';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';

/**
 * The territory tree a phone keeps (spec 11.3): the whole tree, inactive nodes included, for
 * names, filters and pickers. Every caller holds the same tree, so the scope never changes.
 */
@Injectable()
export class TerritoriesSync implements SyncSource<SyncTerritory>, OnModuleInit {
  readonly name = 'territories';
  readonly version = 1;

  constructor(private readonly entities: SyncEntities) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  scope(): Promise<string> {
    return Promise.resolve('tenant');
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncTerritory>[]> {
    const found = await tx
      .select({
        version: territories.rowVersion,
        id: territories.id,
        parentId: territories.parentId,
        level: territories.level,
        code: territories.code,
        name: territories.name,
        active: territories.active,
      })
      .from(territories)
      .where(
        and(
          eq(territories.tenantId, access.tenantId),
          gte(territories.rowVersion, page.since),
          page.after
            ? sql`(${territories.rowVersion}, ${territories.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(territories.rowVersion), asc(territories.id))
      .limit(page.limit);
    return found.map(({ version, ...row }) => ({ version, id: row.id, row }));
  }
}
