import { Module } from '@nestjs/common';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { SyncModule } from '../sync/sync.module';
import { TerritoriesModule } from '../territories/territories.module';
import { IamAccess } from './access.service';
import { IamAdmission } from './admission.service';
import { DesignationsController } from './designations.controller';
import { DesignationsService } from './designations.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { MeController } from './me.controller';
import { OrgChartController } from './org-chart.controller';
import { OrgChartService } from './org-chart.service';
import { ReportingTree } from './reporting-tree';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { Scopes } from './scopes';
import { IamSetup } from './setup.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { UserFieldsController } from './user-fields.controller';
import { UserFieldsService } from './user-fields.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersSync } from './users.sync';

/**
 * Users, roles, permissions, designations, devices and scopes (spec 9.6). It checks every request
 * (`IamAccess`), admits every sign-in on the tenant's behalf (`IamAdmission`), and tells the
 * directory whenever someone's access to sign in changes.
 */
@Module({
  imports: [TerritoriesModule, TenantConfigModule, SyncModule],
  controllers: [
    MeController,
    UsersController,
    RolesController,
    DesignationsController,
    DevicesController,
    TransfersController,
    OrgChartController,
    UserFieldsController,
  ],
  providers: [
    IamAccess,
    IamAdmission,
    Scopes,
    ReportingTree,
    UsersService,
    RolesService,
    DesignationsService,
    DevicesService,
    UsersSync,
    UserFieldsService,
    TransfersService,
    OrgChartService,
    IamSetup,
  ],
  exports: [IamAccess, IamAdmission, Scopes, UsersService, DesignationsService, IamSetup],
})
export class IamModule {}
