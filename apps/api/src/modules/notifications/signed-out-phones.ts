import { Injectable } from '@nestjs/common';
import { Database } from '../../platform/database';
import { SignedOutPhones } from '../../platform/planes';
import { NotificationsService } from './notifications.service';

/** Where the directory's ended phone sessions reach the cell: their push addresses go (M16). */
@Injectable()
export class CellSignedOutPhones extends SignedOutPhones {
  constructor(
    private readonly database: Database,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async forget(tenantId: string, deviceIds: readonly string[], endedAt: Date): Promise<void> {
    await this.database.forTenant(tenantId, (tx) =>
      this.notifications.forgetPhones(tx, tenantId, deviceIds, endedAt),
    );
  }
}
