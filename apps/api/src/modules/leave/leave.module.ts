import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { PhotosModule } from '../media/photos.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveTypesService } from './leave-types.service';
import { LeaveController } from './leave.controller';
import { LeaveYears } from './leave-years';

/**
 * Leave types, requests and balances (M13): spec 9.6 `hr`'s leave, decision D81, with accrual and
 * carry-forward (D114).
 */
@Module({
  imports: [IamModule, FieldModule, PhotosModule, TenantConfigModule, WorkflowModule],
  controllers: [LeaveController],
  providers: [LeaveTypesService, LeaveRequestsService, LeaveYears],
  exports: [LeaveTypesService, LeaveRequestsService],
})
export class LeaveModule {}
