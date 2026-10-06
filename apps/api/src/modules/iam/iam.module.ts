import { Module } from '@nestjs/common';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { IamAccess } from './access.service';
import { IamAdmission } from './admission.service';
import { DesignationsController } from './designations.controller';
import { DesignationsService } from './designations.service';
import { MeController } from './me.controller';
import { ReportingTree } from './reporting-tree';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { Scopes } from './scopes';
import { IamSetup } from './setup.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Users, roles, permissions, designations, devices and scopes (spec 9.6). It checks every request
 * (`IamAccess`), admits every sign-in on the tenant's behalf (`IamAdmission`), and tells the
 * directory whenever someone's access to sign in changes.
 */
@Module({
  imports: [TerritoriesModule, TenantConfigModule],
  controllers: [MeController, UsersController, RolesController, DesignationsController],
  providers: [
    IamAccess,
    IamAdmission,
    Scopes,
    ReportingTree,
    UsersService,
    RolesService,
    DesignationsService,
    IamSetup,
  ],
  exports: [IamAccess, IamAdmission, Scopes, UsersService, DesignationsService, IamSetup],
})
export class IamModule {}
