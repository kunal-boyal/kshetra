import { Injectable } from '@nestjs/common';
import type { SwitchableModule } from '@thelamp/shared';
import { Database } from '../../platform/database';
import { TenantModules } from '../../platform/planes';
import { TenantConfigService } from './tenant-config.service';

/** The modules closed for a tenant, read from its settings with the plan's folded in (D125). */
@Injectable()
export class CellTenantModules extends TenantModules {
  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
  ) {
    super();
  }

  async off(tenantId: string): Promise<readonly SwitchableModule[]> {
    const settings = await this.database.forTenant(tenantId, (tx) =>
      this.config.settings(tx, tenantId),
    );
    return settings.modulesOff;
  }
}
