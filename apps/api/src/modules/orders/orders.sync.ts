import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { SyncOrder } from '@thelamp/shared';
import { and, asc, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { orderLines, orders } from '../../db/schema/orders';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';

/**
 * The orders a phone keeps (M10, decision D78): the ones its person placed, with where each
 * stands, so the phone shows an order's status once it has left the upload queue. Every decision
 * and fulfilment restamps the order.
 */
@Injectable()
export class OrdersSync implements SyncSource<SyncOrder>, OnModuleInit {
  readonly name = 'orders';
  readonly version = 1;

  constructor(private readonly entities: SyncEntities) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  async scope(): Promise<string> {
    return 'own';
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncOrder>[]> {
    const rows = await tx
      .select({
        version: orders.rowVersion,
        id: orders.id,
        accountId: orders.accountId,
        placedAt: orders.placedAt,
        status: orders.status,
        total: orders.total,
        rejectionReason: orders.rejectionReason,
      })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, access.tenantId),
          eq(orders.userId, access.userId),
          gte(orders.rowVersion, page.since),
          page.after
            ? sql`(${orders.rowVersion}, ${orders.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(orders.rowVersion), asc(orders.id))
      .limit(page.limit);
    const counts = new Map(
      rows.length === 0
        ? []
        : (
            await tx
              .select({ orderId: orderLines.orderId, count: count() })
              .from(orderLines)
              .where(
                and(
                  eq(orderLines.tenantId, access.tenantId),
                  inArray(
                    orderLines.orderId,
                    rows.map((row) => row.id),
                  ),
                ),
              )
              .groupBy(orderLines.orderId)
          ).map((row) => [row.orderId, row.count]),
    );
    return rows.map(({ version, placedAt, ...row }) => ({
      version,
      id: row.id,
      row: { ...row, placedAt: placedAt.toISOString(), lineCount: counts.get(row.id) ?? 1 },
    }));
  }
}
