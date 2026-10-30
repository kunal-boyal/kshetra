import { Injectable } from '@nestjs/common';
import { type DashboardResult, type DashboardWaiting, todayIn } from '@thelamp/shared';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AttendanceLeave } from '../field/attendance-leave';
import { ShiftsService } from '../field/shifts.service';
import { SubmissionsService } from '../field/submissions.service';
import { VisitsService } from '../field/visits.service';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { TargetPeriods } from '../metrics/target-periods';
import { PerformanceService } from '../performance/performance.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { ApprovalsService } from '../workflow/approvals.service';

/** The most people the home's on-duty card lists. */
const ON_DUTY_SHOWN = 8;

/**
 * The home dashboard (M18, spec 8.2, decision D63): metric tiles against target with their daily
 * trend, the month's submissions by form, the top of the leaderboard, who is on duty and what waits
 * for the viewer, in one read. Each part follows the viewer's role: their own figures or their
 * team's, and only the parts their permissions allow.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly performance: PerformanceService,
    private readonly submissions: SubmissionsService,
    private readonly shifts: ShiftsService,
    private readonly approvals: ApprovalsService,
    private readonly scopes: Scopes,
    private readonly visits: VisitsService,
    private readonly leave: AttendanceLeave,
    private readonly people: People,
    private readonly config: TenantConfigService,
    private readonly periods: TargetPeriods,
  ) {}

  async read(tx: TenantTx, access: Access, period: string): Promise<DashboardResult> {
    const { ids, ...figures } = await this.performance.dashboard(tx, access, period);
    const can = (permission: Parameters<typeof access.permissions.has>[0]) =>
      access.permissions.has(permission);
    const duty = can('live_map.view') ? await this.duty(tx, access) : null;
    return {
      period,
      ...figures,
      mix: await this.submissions.mixByForm(
        tx,
        access.tenantId,
        ids,
        await this.periods.dates(tx, access.tenantId, period),
      ),
      onDuty: duty?.count ?? null,
      onDutyPeople: duty?.people ?? null,
      onLeaveToday: duty?.onLeave ?? null,
      waiting: await this.waiting(tx, access),
    };
  }

  /**
   * Who in the viewer's scope is on duty now, the first of them longest on duty first with where
   * they are and today's visits, and how many are on approved leave today.
   */
  private async duty(tx: TenantTx, access: Access) {
    const tenantId = access.tenantId;
    const { timezone } = await this.config.settings(tx, tenantId);
    const today = todayIn(timezone);
    const rows = await this.shifts.onDuty(tx, tenantId, await this.scopes.userIds(tx, access));
    const shown = rows.slice(0, ON_DUTY_SHOWN);
    const ids = shown.map((row) => row.userId);
    const names = await this.people.facts(tx, tenantId, ids);
    const open = await this.visits.openFor(tx, tenantId, ids);
    const day = await this.visits.dayCounts(tx, tenantId, ids, today, timezone);
    const scope = await this.people.matching(tx, tenantId, await this.scopes.users(tx, access));
    const leave = await this.leave.days(
      tx,
      tenantId,
      scope.map((person) => person.id),
      today,
      today,
    );
    return {
      count: rows.length,
      people: shown.flatMap((row) => {
        const person = names.get(row.userId);
        if (!person) return [];
        return [
          {
            user: { id: person.id, name: person.name },
            place: open.get(row.userId)?.account.name ?? day.get(row.userId)?.last ?? null,
            visits: day.get(row.userId)?.visits ?? 0,
            paused: row.paused,
            seenAt: row.seenAt?.toISOString() ?? null,
          },
        ];
      }),
      onLeave: [...leave.values()].filter((days) => days.has(today)).length,
    };
  }

  /** What waits for the viewer: the dashboard's part, also read alone for the rail's counts. */
  async waiting(tx: TenantTx, access: Access): Promise<DashboardWaiting> {
    const can = (permission: Parameters<typeof access.permissions.has>[0]) =>
      access.permissions.has(permission);
    return {
      reviews: can('submission.review') ? await this.submissions.waitingReview(tx, access) : null,
      ...(can('approval.act') || can('account.approve')
        ? this.approvalsByKind(await this.approvals.waitingByType(tx, access))
        : { approvals: null, plans: null, leave: null, expenses: null }),
    };
  }

  /** All the approvals waiting, and of them plans, leave with fixed days, and expense claims. */
  private approvalsByKind(counts: Record<string, number>) {
    const of = (...types: string[]) => types.reduce((sum, type) => sum + (counts[type] ?? 0), 0);
    return {
      approvals: Object.values(counts).reduce((sum, count) => sum + count, 0),
      plans: of('journey_plan'),
      leave: of('leave', 'regularisation'),
      expenses: of('expense'),
    };
  }
}
