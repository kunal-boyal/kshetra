import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { PhotosModule } from '../media/photos.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { OrderCredit } from './order-credit';
import { OrderRequests } from './order.requests';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/** Orders (M10, spec 9.6, decision D78). */
@Module({
  imports: [
    AccountsModule,
    CatalogueModule,
    FieldModule,
    IamModule,
    PhotosModule,
    TenantConfigModule,
    TerritoriesModule,
    WorkflowModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrderRequests, OrderCredit],
  exports: [OrdersService, OrderCredit],
})
export class OrdersModule {}
