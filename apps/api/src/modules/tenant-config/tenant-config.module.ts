import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { MediaUrls } from '../media/media-urls';
import { OrganisationController } from './organisation.controller';
import { OrganisationService } from './organisation.service';
import { SettingsController } from './settings.controller';
import { TenantConfigService } from './tenant-config.service';
import { CellTenantModules } from './tenant-modules';

/** Settings, terminology, the organisation's name and logo, and the config version (spec 9.6). */
@Module({
  imports: [MediaModule],
  controllers: [SettingsController, OrganisationController],
  providers: [TenantConfigService, OrganisationService, MediaUrls, CellTenantModules],
  exports: [TenantConfigService, CellTenantModules],
})
export class TenantConfigModule {}
