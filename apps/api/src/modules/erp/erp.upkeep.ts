import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type EventPayload, ErpSettings } from '@thelamp/shared';
import { Database } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { ErpConnectionsService, PULL, PUSH } from './erp-connections.service';
import { ErpRuns } from './erp-runs';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Runs are kept 90 days (decision D129). */
const RUN_KEEP_DAYS = 90;

/**
 * What runs ERP connections in the background (decision D129): each tenant's books are read every
 * hour and on Sync now, accepted orders are sent within a minute and after each read, one run of a
 * connection at a time on the `connectors` queue, and runs past their keeping time are removed daily.
 */
@Injectable()
export class ErpUpkeep implements OnModuleInit {
  constructor(
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly database: Database,
    private readonly connections: ErpConnectionsService,
    private readonly runs: ErpRuns,
    private readonly outbox: Outbox,
  ) {}

  onModuleInit(): void {
    this.queues.handle(
      'connectors',
      PULL,
      (data) =>
        this.runs.pull(
          String(data.tenantId),
          data.connectionId ? String(data.connectionId) : null,
          data.runId ? String(data.runId) : null,
        ),
      { perTenant: true },
    );
    this.queues.handle(
      'connectors',
      PUSH,
      (data) =>
        this.runs.push(String(data.tenantId), data.connectionId ? String(data.connectionId) : null),
      { perTenant: true },
    );
    // An accepted order, or one accepted as it was placed, goes to the books within a minute.
    this.outbox.consume(
      ['order.placed', 'order.status_changed'],
      'erp.orders',
      async (event, tx) => {
        const { status } = event.payload as EventPayload<'order.status_changed'>;
        if (status !== 'accepted' && status !== 'partially_accepted') return;
        const connection = await this.connections.row(tx, event.tenantId);
        if (!connection || connection.status !== 'connected') return;
        if (!ErpSettings.parse(connection.settings).pushOrders) return;
        await this.runs.schedulePush(event.tenantId, connection.id);
      },
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
