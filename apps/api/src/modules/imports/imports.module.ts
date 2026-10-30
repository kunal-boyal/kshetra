import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { BulkController } from './bulk.controller';
import { ImportExamples } from './examples';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportTargets } from './targets';

/**
 * Imports (spec 9.6, M19). Modules that own what can be imported register a target with
 * `ImportTargets`; the worker reads, checks and commits each file.
 */
@Module({
  imports: [MediaModule, TenantConfigModule],
  controllers: [ImportsController, BulkController],
  providers: [ImportsService, ImportTargets, ImportExamples],
  exports: [ImportsService, ImportTargets],
})
export class ImportsModule {}
