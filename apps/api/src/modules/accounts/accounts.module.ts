import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { SyncModule } from '../sync/sync.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AccountTypesController } from './account-types.controller';
import { AccountTypesService } from './account-types.service';
import { AccountsController } from './accounts.controller';
import { AccountsImport } from './accounts.import';
import { AccountRequests } from './accounts.requests';
import { AccountsService } from './accounts.service';
import { AccountsSync, ContactsSync } from './accounts.sync';
import { AccountsUpkeep } from './accounts.upkeep';

/** Account types, accounts, their slots, contacts and proposed locations (spec 5.5, 9.6, M4). */
@Module({
  imports: [
    IamModule,
    TerritoriesModule,
    TenantConfigModule,
    WorkflowModule,
    SyncModule,
    ImportsModule,
  ],
  controllers: [AccountsController, AccountTypesController],
  providers: [
    AccountTypesService,
    AccountsService,
    AccountRequests,
    AccountsSync,
    ContactsSync,
    AccountsImport,
    AccountsUpkeep,
  ],
  exports: [AccountTypesService],
})
export class AccountsModule {}
