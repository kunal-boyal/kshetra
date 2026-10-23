import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Database } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { ApprovalsService } from './approvals.service';

/** How often each tenant's waiting steps are checked for reminders and escalations (spec 5.9). */
const KEEP_TIME_EVERY_MS = 15 * 60_000;

/** The workflow module's background work: reminders and escalations of steps left waiting. */
@Injectable()
export class WorkflowUpkeep implements OnModuleInit {
  constructor(
    private readonly database: Database,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    this.queues.handle('maintenance', 'approvals.keep_time', (data) =>
      this.database
        .forTenant(String(data.tenantId), (tx) =>
          this.approvals.keepTime(tx, String(data.tenantId)),
        )
        .then(() => undefined),
    );
    this.schedules.everyForTenants({
      name: 'approvals_keep_time',
      everyMs: KEEP_TIME_EVERY_MS,
      queue: 'maintenance',
      kind: 'approvals.keep_time',
    });
  }
}
