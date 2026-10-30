import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { FormsModule } from '../forms/forms.module';
import { IamModule } from '../iam/iam.module';
import { OrdersModule } from '../orders/orders.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** Search across the product (phase 4 step A1, decision D110), through each module's own list. */
@Module({
  imports: [IamModule, AccountsModule, OrdersModule, FormsModule, TenantConfigModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
