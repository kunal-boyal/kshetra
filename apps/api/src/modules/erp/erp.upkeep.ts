import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Database } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { ErpConnectionsService, PULL } from './erp-connections.service';
import { ErpPull } from './erp-pull';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Runs are kept 90 days (decision D129). */
const RUN_KEEP_DAYS = 90;

/**
 * What runs ERP connections in the background (decision D129): each tenant's books are read every
 * hour and on Sync now, one tenant's run at a time on the `connectors` queue, and runs past their
 * keeping time are removed daily.
 */
@Injectable()
export class ErpUpkeep implements OnModuleInit {
  constructor(
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly database: Database,
    private readonly connections: ErpConnectionsService,
    private readonly pull: ErpPull,
  ) {}

  onModuleInit(): void {
    this.queues.handle(
      'connectors',
      PULL,
      (data) =>
        this.pull.run(
          String(data.tenantId),
          data.connectionId ? String(data.connectionId) : null,
          data.runId ? String(data.runId) : null,
        ),
      { perTenant: true },
    );
    this.schedules.everyForTenants({
      name: 'erp_pull',
      everyMs: HOUR_MS,
      queue: 'connectors',
      kind: PULL,
    });
    this.queues.handle('maintenance', 'erp.retention', async (data) => {
      const tenantId = String(data.tenantId);
      const cutoff = new Date(Date.now() - RUN_KEEP_DAYS * DAY_MS);
      await this.database.forTenant(tenantId, (tx) =>
        this.connections.removeRunsBefore(tx, tenantId, cutoff),
      );
    });
    this.schedules.everyForTenants({
      name: 'erp_retention',
      everyMs: DAY_MS,
      queue: 'maintenance',
      kind: 'erp.retention',
    });
  }
}
