import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type EventPayload, todayIn } from '@kshetra/shared';
import { sql } from 'drizzle-orm';
import { Database } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { AttendanceService } from './attendance.service';
import { ShiftsService } from './shifts.service';
import { SubmissionsService } from './submissions.service';
import { TrailsService } from './trails.service';
import { VisitsService } from './visits.service';

const DAY_MS = 24 * 3_600_000;

/**
 * The field module's background work (M5, spec 12.1, 12.3):
 * - a shift that starts or ends works out its person's day again, and an ended shift's trail is
 *   compacted, both from the outbox, so they follow the commit and retry on failure;
 * - nightly on each tenant's clock, shifts left open past the longest a shift may last are
 *   closed, trails not yet compacted are, and everyone's day just gone is kept;
 * - daily across the cell, the coming days' location partitions are made;
 * - punching out checks out of the open visit, and every 15 minutes visits idle for 4 hours
 *   check out (M6);
 * - a submission's signature is drawn into an image, and a photo found to repeat another after
 *   its submission arrived flags the submission.
 */
@Injectable()
export class FieldUpkeep implements OnModuleInit {
  private readonly logger = new Logger(FieldUpkeep.name);

  constructor(
    private readonly database: Database,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly outbox: Outbox,
    private readonly config: TenantConfigService,
    private readonly shifts: ShiftsService,
    private readonly trails: TrailsService,
    private readonly attendance: AttendanceService,
    private readonly visits: VisitsService,
    private readonly submissions: SubmissionsService,
  ) {}

  onModuleInit(): void {
    this.outbox.consume(['shift.started', 'shift.ended'], 'field.attendance', async (event, tx) => {
      const shift = event.payload as EventPayload<'shift.started'>;
      const { timezone } = await this.config.settings(tx, event.tenantId);
      await this.attendance.store(
        tx,
        event.tenantId,
        [shift.userId],
        todayIn(timezone, new Date(shift.startedAt)),
      );
    });
    this.outbox.consume(['shift.ended'], 'field.trail', async (event, tx) => {
      const shift = event.payload as EventPayload<'shift.ended'>;
      await this.trails.compact(tx, event.tenantId, shift.shiftId);
    });
    this.outbox.consume(['shift.ended'], 'field.visits', async (event, tx) => {
      const shift = event.payload as EventPayload<'shift.ended'>;
      await this.visits.closeForShift(tx, event.tenantId, shift.shiftId, new Date(shift.endedAt!));
    });
    this.outbox.consume(['media.processed'], 'field.duplicates', async (event, tx) => {
      const photo = event.payload as EventPayload<'media.processed'>;
      if (photo.ownerType === 'submission' && photo.ownerId && photo.duplicateOfId) {
        await this.submissions.flagDuplicate(tx, event.tenantId, photo.ownerId);
      }
    });
    this.queues.handle('media', 'submission.signature', (data) =>
      this.submissions.renderSignature(String(data.tenantId), String(data.submissionId)),
    );
    this.queues.handle('maintenance', 'field.visits_idle', (data) =>
      this.database.forTenant(String(data.tenantId), async (tx) => {
        await this.visits.closeIdle(tx, String(data.tenantId), new Date(String(data.at)));
      }),
    );
    this.schedules.everyForTenants({
      name: 'visits_idle',
      everyMs: 15 * 60_000,
      queue: 'maintenance',
      kind: 'field.visits_idle',
    });
    this.queues.handle('maintenance', 'field.nightly', (data) =>
      this.nightly(String(data.tenantId), String(data.date)),
    );
    this.schedules.atTenantTime({
      name: 'field',
      at: '00:30',
      queue: 'maintenance',
      kind: 'field.nightly',
    });
    this.queues.handle('maintenance', 'field.partitions', () => this.partitions());
    this.schedules.every({
      id: 'field.partitions',
      everyMs: DAY_MS / 4,
      queue: 'maintenance',
      kind: 'field.partitions',
    });
  }

  /** `date` is the tenant's new day; the day just gone is the one before it. */
  async nightly(tenantId: string, date: string): Promise<void> {
    const yesterday = new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
    const closed = await this.database.forTenant(tenantId, (tx) =>
      this.shifts.autoClose(tx, tenantId),
    );
    const pending = await this.database.forTenant(tenantId, (tx) =>
      this.trails.pending(tx, tenantId),
    );
    // One transaction a trail, so one bad shift doesn't hold up the rest.
    for (const shiftId of pending) {
      await this.database.forTenant(tenantId, (tx) => this.trails.compact(tx, tenantId, shiftId));
    }
    const days = await this.database.forTenant(tenantId, (tx) =>
      this.attendance.store(tx, tenantId, 'everyone', yesterday),
    );
    if (closed + pending.length > 0) {
      this.logger.log(
        `Tenant ${tenantId}: ${closed} shifts closed, ${pending.length} trails compacted, ${days} days kept.`,
      );
    }
  }

  /** Makes the coming days' partitions, each under tenant isolation (decision D47). */
  async partitions(): Promise<void> {
    await this.database.db.execute(sql`select cell.maintain_location_partitions()`);
  }
}
