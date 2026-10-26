import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { FormsModule } from '../forms/forms.module';
import { IamModule } from '../iam/iam.module';
import { PlanningModule } from '../planning/planning.module';
import { MediaModule } from '../media/media.module';
import { PhotosModule } from '../media/photos.module';
import { ImportsModule } from '../imports/imports.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AttendanceLeave } from './attendance-leave';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { CalendarsService } from './calendars.service';
import { HolidaysImport } from './holidays.import';
import { RegularisationsService } from './regularisations.service';
import { FieldController } from './field.controller';
import { FieldUpkeep } from './field.upkeep';
import { LocationArchive } from './location-archive';
import { LocationsService } from './locations.service';
import { ShiftsService } from './shifts.service';
import { SubmissionsService } from './submissions.service';
import { TrailsService } from './trails.service';
import { VisitsController } from './visits.controller';
import { VisitOrders } from './visit-orders';
import { VisitsService } from './visits.service';

/**
 * Shifts, location ingest, trails and attendance days (M5), visits and submissions (M6): spec 9.6
 * `field`, 12.1.
 */
@Module({
  imports: [
    IamModule,
    MediaModule,
    PhotosModule,
    TenantConfigModule,
    AccountsModule,
    FormsModule,
    CatalogueModule,
    PlanningModule,
    WorkflowModule,
    ImportsModule,
  ],
  controllers: [FieldController, VisitsController, AttendanceController],
  providers: [
    VisitOrders,
    AttendanceLeave,
    CalendarsService,
    RegularisationsService,
    HolidaysImport,
    ShiftsService,
    LocationsService,
    TrailsService,
    AttendanceService,
    VisitsService,
    SubmissionsService,
    FieldUpkeep,
    LocationArchive,
  ],
  exports: [
    VisitOrders,
    AttendanceLeave,
    CalendarsService,
    AttendanceService,
    ShiftsService,
    SubmissionsService,
    VisitsService,
    LocationsService,
    TrailsService,
  ],
})
export class FieldModule {}
