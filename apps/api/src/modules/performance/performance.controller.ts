import { Controller, Get, Query } from '@nestjs/common';
import {
  Leaderboard,
  LeaderboardQuery,
  PerformanceQuery,
  PersonPerformance,
  TeamPerformance,
  TeamPerformanceQuery,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { DashboardLayoutsService } from './dashboard-layouts.service';
import { PerformanceService } from './performance.service';

/** Performance (M9): a person's month, the team's, and the leaderboards. */
@Controller('v1')
export class PerformanceController {
  constructor(
    private readonly database: Database,
    private readonly performance: PerformanceService,
    private readonly layouts: DashboardLayoutsService,
  ) {}

  @Get('performance')
  @Contract({
    tag: 'Performance',
    summary: "A person's month: actuals against targets, score, rank and the daily trend",
    query: PerformanceQuery,
    response: PersonPerformance,
  })
  @SignedIn()
  person(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = PerformanceQuery.parse(query);
    return this.database.forTenant(access.tenantId, async (tx) => {
      const month = await this.performance.person(tx, access, input.period, input.userId);
      // The caller's own month leads with their role's Home tiles, as the phone shows it (D122).
      const own = !input.userId || input.userId === access.userId;
      const layout = own ? await this.layouts.forCaller(tx, access) : null;
      const tiles = layout?.find((card) => card.kind === 'tiles');
      return { ...month, tileKeys: tiles?.kind === 'tiles' ? tiles.metrics : null };
    });
  }

  @Get('performance/team')
  @Contract({
    tag: 'Performance',
    summary: 'The month for the people in scope, with the team totals',
    query: TeamPerformanceQuery,
    response: TeamPerformance,
  })
  @Requires('performance.view_team')
  team(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = TeamPerformanceQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.performance.team(tx, access, input.period),
    );
  }

  @Get('leaderboard')
  @Contract({
    tag: 'Performance',
    summary: "A ranking group's scores and ranks for the month, indicative",
    query: LeaderboardQuery,
    response: Leaderboard,
  })
  @Requires('leaderboard.view')
  leaderboard(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = LeaderboardQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.performance.leaderboard(tx, access, input.period, input.group),
    );
  }
}
