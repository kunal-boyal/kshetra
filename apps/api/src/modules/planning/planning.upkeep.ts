import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type EventPayload, todayIn } from '@thelamp/shared';
import { Database } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { RequestTypes } from '../workflow/request-types';
import { PlanningService } from './planning.service';

/**
 * The planning module's background work and seams (M8, BR-35):
 * - a submission reviewed, or approved as it arrives, moves the plan item its visit came from;
 * - just after midnight on each tenant's clock, planned items whose day has ended are missed;
 * - a month's plan goes to the manager as a `journey_plan` request.
 */
@Injectable()
export class PlanningUpkeep implements OnModuleInit {
  constructor(
    private readonly database: Database,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly outbox: Outbox,
    private readonly config: TenantConfigService,
    private readonly types: RequestTypes,
    private readonly planning: PlanningService,
  ) {}

  onModuleInit(): void {
    this.outbox.consume(['submission.reviewed'], 'planning.reviewed', async (event, tx) => {
      const review = event.payload as EventPayload<'submission.reviewed'>;
      if (review.visitId) {
        await this.planning.reviewed(tx, event.tenantId, review.visitId, review.status);
      }
    });
    // A form that needs no review is approved as it arrives.
    this.outbox.consume(['submission.created'], 'planning.created', async (event, tx) => {
      const created = event.payload as EventPayload<'submission.created'>;
      if (created.visitId && created.status === 'approved') {
        await this.planning.reviewed(tx, event.tenantId, created.visitId, 'approved');
      }
    });
    this.queues.handle('maintenance', 'planning.nightly', (data) =>
      this.database
        .forTenant(String(data.tenantId), async (tx) => {
          const { timezone } = await this.config.settings(tx, String(data.tenantId));
          await this.planning.missDayEnded(tx, String(data.tenantId), todayIn(timezone));
        })
        .then(() => undefined),
    );
    this.schedules.atTenantTime({
      name: 'planning',
      at: '00:10',
      queue: 'maintenance',
      kind: 'planning.nightly',
    });
    this.types.register({
      type: 'journey_plan',
      fallbackPermission: 'plan_item.manage',
      bulk: true,
      subjects: (tx, tenantId, ids) => this.planning.subjects(tx, tenantId, ids),
      // A withdrawn month goes back to draft, as a rejected one does.
      decided: (tx, by, id, outcome) =>
        this.planning.decided(tx, by, id, outcome === 'approved' ? 'approved' : 'rejected'),
    });
  }
}
