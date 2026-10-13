import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { PhotosModule } from '../media/photos.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { AttendanceService } from './attendance.service';
import { FieldController } from './field.controller';
import { FieldUpkeep } from './field.upkeep';
import { LocationsService } from './locations.service';
import { ShiftsService } from './shifts.service';
import { TrailsService } from './trails.service';

/** Shifts, location ingest, trails and attendance days (M5, spec 9.6 `field`, 12.1). */
@Module({
  imports: [IamModule, PhotosModule, TenantConfigModule],
  controllers: [FieldController],
  providers: [ShiftsService, LocationsService, TrailsService, AttendanceService, FieldUpkeep],
  exports: [AttendanceService, ShiftsService],
})
export class FieldModule {}
