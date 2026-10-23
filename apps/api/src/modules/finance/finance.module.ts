import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { ImportsModule } from '../imports/imports.module';
import { OrdersModule } from '../orders/orders.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { FinanceController } from './finance.controller';
import { FinanceSnapshotsImport, LedgerEntriesImport } from './finance.import';
import { FinanceService } from './finance.service';

/** Account finance: balances, ageing and statements (M11, spec 9.6, decision D79). */
@Module({
  imports: [AccountsModule, ImportsModule, OrdersModule, TenantConfigModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceSnapshotsImport, LedgerEntriesImport],
  exports: [FinanceService],
})
export class FinanceModule {}
