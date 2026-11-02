import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuditModule } from '../audit/audit.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { PhotosModule } from '../media/photos.module';
import { SyncModule } from '../sync/sync.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { OrderCredit } from './order-credit';
import { OrderStock } from './order-stock';
import { VisitOrdersProvider } from './visit-orders.provider';
import { OrderRequests } from './order.requests';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersSync } from './orders.sync';
import { AccountSchemesController, SchemesController } from './schemes.controller';
import { SchemesService } from './schemes.service';
import { SchemesSync } from './schemes.sync';

/** Orders (M10, spec 9.6, decision D78). */
@Module({
  imports: [
    AccountsModule,
    AuditModule,
    CatalogueModule,
    FieldModule,
    IamModule,
    PhotosModule,
    SyncModule,
    TenantConfigModule,
    TerritoriesModule,
    WorkflowModule,
  ],
  controllers: [OrdersController, SchemesController, AccountSchemesController],
  providers: [
    OrdersService,
    OrderRequests,
    OrderCredit,
    OrderStock,
    OrdersSync,
    VisitOrdersProvider,
    SchemesService,
    SchemesSync,
  ],
  exports: [OrdersService, OrderCredit, OrderStock, SchemesService],
})
export class OrdersModule {}
