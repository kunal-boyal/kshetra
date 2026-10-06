import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { TenantConfigService } from './tenant-config.service';

/** Settings, terminology and the config version (spec 9.6). */
@Module({
  controllers: [SettingsController],
  providers: [TenantConfigService],
  exports: [TenantConfigService],
})
export class TenantConfigModule {}
