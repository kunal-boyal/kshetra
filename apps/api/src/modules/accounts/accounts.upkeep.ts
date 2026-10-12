import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Database } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { AccountsService } from './accounts.service';

/**
 * Nightly upkeep of accounts on each tenant's clock (M4): segments re-tagged, and accounts whose
 * slot holders change that day restamped so phones hear of it. It runs after the transfers of
 * 00:05, so a transfer's new territories count.
 */
@Injectable()
export class AccountsUpkeep implements OnModuleInit {
  private readonly logger = new Logger(AccountsUpkeep.name);

  constructor(
    private readonly database: Database,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly accounts: AccountsService,
  ) {}

  onModuleInit(): void {
    this.queues.handle('maintenance', 'accounts.daily', (data) =>
      this.run(String(data.tenantId), String(data.date)),
    );
    this.schedules.atTenantTime({
      name: 'accounts',
      at: '00:15',
      queue: 'maintenance',
      kind: 'accounts.daily',
    });
  }

  async run(tenantId: string, date: string): Promise<void> {
    const changed = await this.database.forTenant(tenantId, (tx) =>
      this.accounts.daily(tx, tenantId, date),
    );
    if (changed > 0) this.logger.log(`Tenant ${tenantId}: ${changed} accounts restamped.`);
  }
}
