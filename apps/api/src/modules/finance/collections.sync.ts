import { Injectable, type OnModuleInit } from '@nestjs/common';
import { collectionNumber, scaled, type SyncCollection, todayIn, unscaled } from '@thelamp/shared';
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
import { CollectionsService } from './collections.service';

/** How far back a phone keeps its person's own collections. */
const OWN_DAYS = 60;

/**
 * What a phone keeps of collections (BR-63, decision D132): its person's own of the last 60 days,
 * with what the office decided, and every collection not yet in the books at the accounts it
 * sees, so what an account owes after them reads the same offline. Nothing while account finance
 * is off (D82), and only for people who record or see collections; the scope follows the accounts
 * they see.
 */
@Injectable()
export class CollectionsSync implements SyncSource<SyncCollection>, OnModuleInit {
  readonly name = 'collections';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly accounts: AccountsService,
    private readonly config: TenantConfigService,
    private readonly collections: CollectionsService,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  private open(access: Access): boolean {
    return (
      !access.modulesOff.includes('account_finance') &&
      (access.permissions.has('collection.record') || access.permissions.has('collection.view'))
    );
  }

  async scope(tx: TenantTx, access: Access): Promise<string> {
    if (access.modulesOff.includes('account_finance')) return 'off';
    if (!this.open(access)) return 'none';
    return this.accounts.reachHash(tx, access);
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncCollection>[]> {
    if (!this.open(access)) return [];
    const today = todayIn((await this.config.settings(tx, access.tenantId)).timezone);
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - OWN_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const rows = await this.collections.forSync(
      tx,
      access,
      await this.accounts.reachIds(tx, access),
      since,
      page,
    );
    return rows.map((row) => ({
      version: Number(row.rowVersion),
      id: row.id,
      row: {
        id: row.id,
        number: collectionNumber(row.number),
        accountId: row.accountId,
        userId: row.userId,
        collectedOn: row.collectedOn,
        collectedAt: row.collectedAt.toISOString(),
        amount: unscaled(scaled(row.amount, 2), 2),
        mode: row.mode,
        reference: row.reference,
        chequeNumber: row.chequeNumber,
        chequeBank: row.chequeBank,
        chequeDate: row.chequeDate,
        status: row.status,
        reason: row.reason,
      },
    }));
  }
}
