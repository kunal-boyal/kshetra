import { Injectable, type OnModuleInit } from '@nestjs/common';
import { resolveTerminology, translate } from '@thelamp/i18n';
import {
  type EventPayload,
  type Locale,
  type ReportKey,
  TRACKING_REPORT_MINUTES,
  TRACKING_SILENCE_MINUTES,
  timeIn,
  todayIn,
} from '@thelamp/shared';
import { Database } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { ShiftsService } from '../field/shifts.service';
import { FormsService } from '../forms/forms.service';
import { People } from '../iam/people';
import { PlanningService } from '../planning/planning.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { DELIVER, NotificationsService } from './notifications.service';
import { NotificationDelivery } from './delivery';

/** Minutes past the plan time within which the morning notification still goes (M16). */
const PLAN_WINDOW_MINUTES = 180;

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
};

/**
 * Turns what happens into notifications (M16, decision D58):
 * - a submission rejected by a person tells its submitter;
 * - a request waiting tells its approvers, and its decision tells the requester;
 * - targets locked tell their person; an import or export finished tells who started it;
 * - each tenant's plan time tells field users with plan items today;
 * - every 5 minutes, a shift quiet for 20 minutes tells its person, and at 40 their manager.
 * Every notification names its occurrence, so an event delivered twice notifies once.
 */
@Injectable()
export class NotificationsUpkeep implements OnModuleInit {
  constructor(
    private readonly database: Database,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly outbox: Outbox,
    private readonly config: TenantConfigService,
    private readonly people: People,
    private readonly forms: FormsService,
    private readonly planning: PlanningService,
    private readonly shifts: ShiftsService,
    private readonly notifications: NotificationsService,
    private readonly delivery: NotificationDelivery,
  ) {}

  private async name(
    tx: Parameters<NotificationsService['notify']>[0],
    tenantId: string,
    id: string,
  ) {
    return (await this.people.facts(tx, tenantId, [id])).get(id)?.name ?? '';
  }

  /** Field users with plan items today hear of them, once a day, from the tenant's plan time. */
  async morningPlan(tenantId: string, now: Date = new Date()): Promise<number> {
    return this.database.forTenant(tenantId, async (tx) => {
      const settings = await this.config.settings(tx, tenantId);
      const late =
        minutesOf(timeIn(settings.timezone, now)) - minutesOf(settings.planNotificationTime);
      if (late < 0 || late > PLAN_WINDOW_MINUTES) return 0;
      const today = todayIn(settings.timezone, now);
      let sent = 0;
      for (const { userId, count } of await this.planning.dueOn(tx, tenantId, today)) {
        const id = await this.notifications.notify(tx, tenantId, {
          userId,
          event: 'plan.today',
          values: { count },
          link: '/',
          dedupeKey: `plan:${today}`,
        });
        if (id) sent += 1;
      }
      return sent;
    });
  }

  /** Shifts gone quiet: the person at 20 minutes, their manager at 40, once per gap. */
  async trackingStopped(tenantId: string, now: Date = new Date()): Promise<number> {
    return this.database.forTenant(tenantId, async (tx) => {
      let sent = 0;
      for (const quiet of await this.shifts.silent(tx, tenantId, now, TRACKING_SILENCE_MINUTES)) {
        const gap = quiet.since.toISOString();
        if (
          await this.notifications.notify(tx, tenantId, {
            userId: quiet.userId,
            event: 'tracking.stopped',
            values: {},
            link: '/',
            dedupeKey: `tracking:${quiet.shiftId}:${gap}`,
          })
        ) {
          sent += 1;
        }
        if (now.getTime() - quiet.since.getTime() < TRACKING_REPORT_MINUTES * 60_000) continue;
        const person = (await this.people.facts(tx, tenantId, [quiet.userId])).get(quiet.userId);
        if (!person?.managerId) continue;
        if (
          await this.notifications.notify(tx, tenantId, {
            userId: person.managerId,
            event: 'tracking.stopped_report',
            values: { name: person.name },
            link: null,
            dedupeKey: `tracking-report:${quiet.shiftId}:${gap}`,
          })
        ) {
          sent += 1;
        }
      }
      return sent;
    });
  }

  onModuleInit(): void {
    this.outbox.consume(['submission.reviewed'], 'notifications.rejected', async (event, tx) => {
      const review = event.payload as EventPayload<'submission.reviewed'>;
      if (review.status !== 'rejected' || review.auto || !review.reviewerId) return;
      const form = (await this.forms.list(tx, event.tenantId)).find(
        (entry) => entry.key === review.formKey,
      );
      await this.notifications.notify(tx, event.tenantId, {
        userId: review.userId,
        event: 'submission.rejected',
        values: {
          name: await this.name(tx, event.tenantId, review.reviewerId),
          form_en: form?.name.en.one ?? review.formKey,
          form_hi: form?.name.hi.one ?? review.formKey,
          note: review.note ?? '',
        },
        link: null,
        dedupeKey: `rejected:${event.id}`,
      });
    });
    this.outbox.consume(['approval.requested'], 'notifications.approvals', async (event, tx) => {
      const request = event.payload as EventPayload<'approval.requested'>;
      const name = await this.name(tx, event.tenantId, request.requesterId);
      for (const approver of request.approverIds) {
        await this.notifications.notify(tx, event.tenantId, {
          userId: approver,
          event: 'approval.waiting',
          values: { name },
          link: '/approvals',
          dedupeKey: `approval:${request.approvalId}`,
        });
      }
    });
    // A later step, an escalation or a reminder reaches the people it names (decision D74). A
    // reminder is once per step; each step and escalation notifies its people once.
    this.outbox.consume(['approval.waiting'], 'notifications.waiting', async (event, tx) => {
      const waiting = event.payload as EventPayload<'approval.waiting'>;
      const name = await this.name(tx, event.tenantId, waiting.requesterId);
      for (const approver of waiting.approverIds) {
        await this.notifications.notify(tx, event.tenantId, {
          userId: approver,
          event: 'approval.waiting',
          values: { name },
          link: '/approvals',
          dedupeKey: `approval:${waiting.approvalId}:${waiting.stepIndex}:${waiting.reason}`,
        });
      }
    });
    this.outbox.consume(['approval.decided'], 'notifications.decided', async (event, tx) => {
      const decided = event.payload as EventPayload<'approval.decided'>;
      await this.notifications.notify(tx, event.tenantId, {
        userId: decided.requesterId,
        event: 'approval.decided',
        values: {
          name: await this.name(tx, event.tenantId, decided.deciderId),
          outcome: decided.outcome,
        },
        link: null,
        dedupeKey: `decided:${decided.approvalId}`,
      });
    });
    this.outbox.consume(['target.locked'], 'notifications.targets', async (event, tx) => {
      const locked = event.payload as EventPayload<'target.locked'>;
      await this.notifications.notify(tx, event.tenantId, {
        userId: locked.userId,
        event: 'target.locked',
        values: { month: locked.period },
        link: null,
        dedupeKey: `target:${event.id}`,
      });
    });
    this.outbox.consume(['import.finished'], 'notifications.imports', async (event, tx) => {
      const finished = event.payload as EventPayload<'import.finished'>;
      await this.notifications.notify(tx, event.tenantId, {
        userId: finished.userId,
        event: 'import.finished',
        values: {
          status: finished.status,
          file: finished.fileName,
          created: finished.created ?? 0,
          updated: finished.updated ?? 0,
        },
        link: `/imports/${finished.importId}`,
        dedupeKey: `import:${finished.importId}`,
      });
    });

    this.outbox.consume(['export.finished'], 'notifications.exports', async (event, tx) => {
      const finished = event.payload as EventPayload<'export.finished'>;
      const terms = await this.config.terminology(tx, event.tenantId);
      const name = (locale: Locale) =>
        translate(`report.name_${finished.report as ReportKey}`, {
          locale,
          terms: resolveTerminology(terms, locale),
        });
      await this.notifications.notify(tx, event.tenantId, {
        userId: finished.userId,
        event: 'export.finished',
        values: {
          status: finished.status,
          report_en: name('en'),
          report_hi: name('hi'),
          month: finished.period,
        },
        link: '/reports',
        dedupeKey: `export:${finished.exportId}`,
      });
    });

    this.queues.handle('notifications', DELIVER, (data) =>
      this.delivery.deliver(String(data.tenantId), String(data.deliveryId)),
    );
    this.queues.handle('notifications', 'notifications.plan', async (data) => {
      await this.morningPlan(String(data.tenantId));
    });
    this.queues.handle('notifications', 'notifications.tracking', async (data) => {
      await this.trackingStopped(String(data.tenantId));
    });
    this.schedules.everyForTenants({
      name: 'notifications.plan',
      everyMs: 15 * 60_000,
      queue: 'notifications',
      kind: 'notifications.plan',
    });
    this.schedules.everyForTenants({
      name: 'notifications.tracking',
      everyMs: 5 * 60_000,
      queue: 'notifications',
      kind: 'notifications.tracking',
    });
  }
}
