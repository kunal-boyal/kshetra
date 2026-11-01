import { Injectable, type OnModuleInit } from '@nestjs/common';
import { previousPeriod, type SyncSellThrough, todayIn } from '@thelamp/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { sellThroughLines, sellThroughStatements } from '../../db/schema/sell-through';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { plain } from './sell-through.service';

/**
 * What a phone keeps of sell-through (BR-53, decision D124): the latest version of this month's
 * and last month's statement of each account its person sees, so it carries closings forward and
 * shows what was recorded offline. Only for people who record them; the scope follows the accounts
 * they see and the month, so a new month starts a fresh copy.
 */
@Injectable()
export class SellThroughSync implements SyncSource<SyncSellThrough>, OnModuleInit {
  readonly name = 'sell_through';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly accounts: AccountsService,
    private readonly config: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  private async month(tx: TenantTx, tenantId: string): Promise<string> {
    return todayIn((await this.config.settings(tx, tenantId)).timezone).slice(0, 7);
  }

  async scope(tx: TenantTx, access: Access): Promise<string> {
    if (!access.permissions.has('sell_through.record')) return 'none';
    return `${await this.accounts.reachHash(tx, access)}:${await this.month(tx, access.tenantId)}`;
  }

  async rows(
    tx: TenantTx,
    access: Access,
    page: SyncRowsPage,
  ): Promise<SyncRow<SyncSellThrough>[]> {
    if (!access.permissions.has('sell_through.record')) return [];
    const month = await this.month(tx, access.tenantId);
    const reach = await this.accounts.reachIds(tx, access);
    const statements = await tx
      .select()
      .from(sellThroughStatements)
      .where(
        and(
          eq(sellThroughStatements.tenantId, access.tenantId),
          inArray(sellThroughStatements.period, [month, previousPeriod(month)]),
          sql`${sellThroughStatements.accountId}::text in (${reach})`,
          sql`not exists (
            select 1 from ${sellThroughStatements} later
             where later.tenant_id = ${sellThroughStatements.tenantId}
               and later.account_id = ${sellThroughStatements.accountId}
               and later.period = ${sellThroughStatements.period}
               and later.version > ${sellThroughStatements.version})`,
          sql`${sellThroughStatements.rowVersion} >= ${page.since}`,
          page.after
            ? sql`(${sellThroughStatements.rowVersion}, ${sellThroughStatements.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : sql`true`,
        ),
      )
      .orderBy(sellThroughStatements.rowVersion, sellThroughStatements.id)
      .limit(page.limit);
    const lines = statements.length
      ? await tx
          .select()
          .from(sellThroughLines)
          .where(
            and(
              eq(sellThroughLines.tenantId, access.tenantId),
              inArray(
                sellThroughLines.statementId,
                statements.map((row) => row.id),
              ),
            ),
          )
      : [];
    return statements.map((statement) => ({
      version: Number(statement.rowVersion),
      id: statement.id,
      row: {
        id: statement.id,
        accountId: statement.accountId,
        period: statement.period,
        version: statement.version,
        recordedAt: statement.recordedAt.toISOString(),
        value: statement.value,
        lines: lines
          .filter((line) => line.statementId === statement.id)
          .map((line) => ({
            itemId: line.itemId,
            opening: plain(line.opening),
            received: plain(line.received),
            returned: plain(line.returned),
            closing: plain(line.closing),
            sold: plain(line.sold),
            flags: line.flags,
          })),
      },
    }));
  }
}
