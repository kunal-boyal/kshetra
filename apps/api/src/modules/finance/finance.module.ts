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

/** Account finance: balances, ageing and statements (M11, spec 9.6, decision D79). */
@Module({
  imports: [AccountsModule, ImportsModule, OrdersModule, SyncModule, TenantConfigModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceSnapshotsImport, LedgerEntriesImport, BalancesSync],
  exports: [FinanceService],
})
export class FinanceModule {}
