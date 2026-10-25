import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { BulkController } from './bulk.controller';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportTargets } from './targets';

/**
 * Imports (spec 9.6, M19). Modules that own what can be imported register a target with
 * `ImportTargets`; the worker reads, checks and commits each file.
 */
@Module({
  imports: [MediaModule],
  controllers: [ImportsController, BulkController],
  providers: [ImportsService, ImportTargets],
  exports: [ImportsService, ImportTargets],
})
export class ImportsModule {}
