import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { SyncItem } from '@thelamp/shared';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';
import { CatalogueService } from './catalogue.service';

/**
 * The catalogue a phone keeps (spec 5.11, 11.3): every item, for item lines and catalogue choices
 * offline. Everyone signed in may read the catalogue, so the scope is the tenant. A change to an
 * item's product or category restamps the item, so its copy follows.
 */
@Injectable()
export class ItemsSync implements SyncSource<SyncItem>, OnModuleInit {
  readonly name = 'items';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly catalogue: CatalogueService,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  async scope(): Promise<string> {
    return 'tenant';
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncItem>[]> {
    return this.catalogue.itemRows(tx, access.tenantId, page);
  }
}
