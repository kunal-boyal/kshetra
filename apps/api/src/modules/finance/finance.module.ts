import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { PhotosModule } from '../media/photos.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { SyncModule } from '../sync/sync.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { CollectionsSync } from './collections.sync';
import { CollectionsUpkeep } from './collections.upkeep';
import { FinanceController } from './finance.controller';
import { FinanceSnapshotsImport, LedgerEntriesImport } from './finance.import';
import { FinanceService } from './finance.service';
import { BalancesSync } from './finance.sync';
import { InvoicesImport, ReceiptsImport } from './receivables.import';
import { ReceivablesService } from './receivables.service';

/**
 * Account finance: balances, ageing and statements (M11, spec 9.6, decision D79), the
 * customer's invoices and receipts (D121), and the collections the field takes (D132).
 */
@Module({
  imports: [
    AccountsModule,
    FieldModule,
    IamModule,
    ImportsModule,
    NotificationsModule,
    OrdersModule,
    PhotosModule,
    SyncModule,
    TenantConfigModule,
  ],
  controllers: [FinanceController, CollectionsController],
  providers: [
    FinanceService,
    ReceivablesService,
    CollectionsService,
    FinanceSnapshotsImport,
    LedgerEntriesImport,
    InvoicesImport,
    ReceiptsImport,
    BalancesSync,
    CollectionsSync,
    CollectionsUpkeep,
  ],
  exports: [FinanceService, ReceivablesService, CollectionsService],
})
export class FinanceModule {}
