import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { FormsModule } from '../forms/forms.module';
import { IamModule } from '../iam/iam.module';
import { PlanningModule } from '../planning/planning.module';
import { PhotosModule } from '../media/photos.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { AttendanceService } from './attendance.service';
import { FieldController } from './field.controller';
import { FieldUpkeep } from './field.upkeep';
import { LocationsService } from './locations.service';
import { ShiftsService } from './shifts.service';
import { SubmissionsService } from './submissions.service';
import { TrailsService } from './trails.service';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

/**
 * Shifts, location ingest, trails and attendance days (M5), visits and submissions (M6): spec 9.6
 * `field`, 12.1.
 */
@Module({
  imports: [
    IamModule,
    PhotosModule,
    TenantConfigModule,
    AccountsModule,
    FormsModule,
    CatalogueModule,
    PlanningModule,
  ],
  controllers: [FieldController, VisitsController],
  providers: [
    ShiftsService,
    LocationsService,
    TrailsService,
    AttendanceService,
    VisitsService,
    SubmissionsService,
    FieldUpkeep,
  ],
  exports: [
    AttendanceService,
    ShiftsService,
    SubmissionsService,
    VisitsService,
    LocationsService,
    TrailsService,
  ],
})
export class FieldModule {}
