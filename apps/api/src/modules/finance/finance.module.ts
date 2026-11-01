import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { ImportsModule } from '../imports/imports.module';
import { OrdersModule } from '../orders/orders.module';
import { SyncModule } from '../sync/sync.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { FinanceController } from './finance.controller';
import { FinanceSnapshotsImport, LedgerEntriesImport } from './finance.import';
import { FinanceService } from './finance.service';
import { BalancesSync } from './finance.sync';
import { InvoicesImport, ReceiptsImport } from './receivables.import';
import { ReceivablesService } from './receivables.service';

/**
 * Account finance: balances, ageing and statements (M11, spec 9.6, decision D79), and the
 * customer's invoices and receipts (D121).
 */
@Module({
  imports: [AccountsModule, ImportsModule, OrdersModule, SyncModule, TenantConfigModule],
  controllers: [FinanceController],
  providers: [
    FinanceService,
    ReceivablesService,
    FinanceSnapshotsImport,
    LedgerEntriesImport,
    InvoicesImport,
    ReceiptsImport,
    BalancesSync,
  ],
  exports: [FinanceService, ReceivablesService],
})
export class FinanceModule {}
