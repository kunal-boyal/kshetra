import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { SyncScheme } from '@thelamp/shared';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { schemes } from '../../db/schema/schemes';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';

/**
 * The schemes a phone keeps (BR-55, decision D127), so a cart is priced offline as the server
 * will price it. Every scheme goes, switched off and ended ones too, so a change reaches the
 * phone as the row it changed; `schemeApplies()` judges which reach a line. Only for people who
 * take orders, and none while the orders module is off.
 */
@Injectable()
export class SchemesSync implements SyncSource<SyncScheme>, OnModuleInit {
  readonly name = 'schemes';
  readonly version = 1;

  constructor(private readonly entities: SyncEntities) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  private takesOrders(access: Access): boolean {
    return !access.modulesOff.includes('orders') && access.permissions.has('order.create');
  }

  async scope(_tx: TenantTx, access: Access): Promise<string> {
    if (access.modulesOff.includes('orders')) return 'off';
    return this.takesOrders(access) ? 'all' : 'none';
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncScheme>[]> {
    if (!this.takesOrders(access)) return [];
    const rows = await tx
      .select()
      .from(schemes)
      .where(
        and(
          eq(schemes.tenantId, access.tenantId),
          gte(schemes.rowVersion, page.since),
          page.after
            ? sql`(${schemes.rowVersion}, ${schemes.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(schemes.rowVersion), asc(schemes.id))
      .limit(page.limit);
    return rows.map((row) => ({
      version: Number(row.rowVersion),
      id: row.id,
      row: {
        id: row.id,
        key: row.key,
        name: row.name as SyncScheme['name'],
        kind: row.kind as SyncScheme['kind'],
        rule: row.rule as SyncScheme['rule'],
        itemIds: row.itemIds,
        categoryIds: row.categoryIds,
        accountTypeKeys: row.accountTypeKeys,
        territoryIds: row.territoryIds,
        validFrom: row.validFrom,
        validTo: row.validTo,
        active: row.active,
      },
    }));
  }
}
