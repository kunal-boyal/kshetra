import { Injectable } from '@nestjs/common';
import type { DashboardResult } from '@kshetra/shared';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { ShiftsService } from '../field/shifts.service';
import { SubmissionsService } from '../field/submissions.service';
import { Scopes } from '../iam/scopes';
import { PerformanceService } from '../performance/performance.service';
import { ApprovalsService } from '../workflow/approvals.service';

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
  ) {}

  async read(tx: TenantTx, access: Access, period: string): Promise<DashboardResult> {
    const { ids, ...figures } = await this.performance.dashboard(tx, access, period);
    const can = (permission: Parameters<typeof access.permissions.has>[0]) =>
      access.permissions.has(permission);
    return {
      period,
      ...figures,
      mix: await this.submissions.mixByForm(tx, access.tenantId, ids, period),
      onDuty: can('live_map.view')
        ? (await this.shifts.onDuty(tx, access.tenantId, await this.scopes.userIds(tx, access)))
            .length
        : null,
      waiting: {
        reviews: can('submission.review') ? await this.submissions.waitingReview(tx, access) : null,
        approvals:
          can('approval.act') || can('account.approve')
            ? await this.approvals.waitingCount(tx, access)
            : null,
      },
    };
  }
}
