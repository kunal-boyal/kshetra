import { Body, Controller, Get, Headers, HttpCode, Post, Put, Query } from '@nestjs/common';
import {
  AccountPlanQuery,
  AccountPlanResult,
  CopyTargetsBody,
  CopyTargetsResult,
  LockTargetsBody,
  LockTargetsResult,
  PutAccountPlanBody,
  PutTargetsBody,
  PutTargetsResult,
  TargetListQuery,
  TargetListResult,
  TargetSetResult,
  UnlockTargetBody,
} from '@kshetra/shared';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { AccountPlansService } from './account-plans.service';
import { TargetsService } from './targets.service';

/**
 * Targets and account plans (spec 11.2 Planning group, 5.8, M8). Every change carries an
 * `Idempotency-Key`, so one sent twice is applied once (BR-46).
 */
@Controller('v1')
export class TargetsController {
  constructor(
    private readonly database: Database,
    private readonly targets: TargetsService,
    private readonly plans: AccountPlansService,
  ) {}

  /** Runs a change once per idempotency key. */
  private once<T>(
    access: Access,
    key: string | undefined,
    route: string,
    input: unknown,
    work: (tx: Parameters<Parameters<Database['forTenant']>[1]>[0]) => Promise<T>,
  ): Promise<T> {
    return this.database
      .forTenant(access.tenantId, (tx) =>
        idempotent(
          tx,
          access.tenantId,
          requireIdempotencyKey(key),
          { route, by: access.userId, input },
          async () => ({ status: 200, body: await work(tx) }),
        ),
      )
      .then((result) => result.body as T);
  }

  @Get('targets')
  @Contract({
    tag: 'Planning',
    summary: "The month's targets of the people in scope, the caller's own, and team totals",
    query: TargetListQuery,
    response: TargetListResult,
  })
  @Requires('target.view')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = TargetListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.targets.list(tx, access, input.period),
    );
  }

  @Put('targets')
  @Contract({
    tag: 'Planning',
    summary: 'Draft target values for some people, each at the version seen',
    body: PutTargetsBody,
    response: PutTargetsResult,
    idempotencyKey: true,
  })
  @Requires('target.edit')
  put(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = PutTargetsBody.parse(body);
    return this.once(access, key, 'PUT /v1/targets', input, (tx) =>
      this.targets.put(tx, access, input),
    );
  }

  @Post('targets/lock')
  @HttpCode(200)
  @Contract({
    tag: 'Planning',
    summary: "Lock these people's draft targets for the month",
    body: LockTargetsBody,
    response: LockTargetsResult,
    idempotencyKey: true,
  })
  @Requires('target.lock')
  lock(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = LockTargetsBody.parse(body);
    return this.once(access, key, 'POST /v1/targets/lock', input, (tx) =>
      this.targets.lock(tx, access, input),
    );
  }

  @Post('targets/unlock')
  @HttpCode(200)
  @Contract({
    tag: 'Planning',
    summary: "Unlock a person's targets for the month, with a reason",
    body: UnlockTargetBody,
    response: TargetSetResult,
    idempotencyKey: true,
  })
  @Requires('target.unlock')
  unlock(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = UnlockTargetBody.parse(body);
    return this.once(access, key, 'POST /v1/targets/unlock', input, (tx) =>
      this.targets.unlock(tx, access, input),
    );
  }

  @Post('targets/copy')
  @HttpCode(200)
  @Contract({
    tag: 'Planning',
    summary: "Copy an earlier month's targets into these people's drafts",
    body: CopyTargetsBody,
    response: CopyTargetsResult,
    idempotencyKey: true,
  })
  @Requires('target.edit')
  copy(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = CopyTargetsBody.parse(body);
    return this.once(access, key, 'POST /v1/targets/copy', input, (tx) =>
      this.targets.copy(tx, access, input),
    );
  }

  @Get('account-plans')
  @Contract({
    tag: 'Planning',
    summary: "An account's planned values for a month",
    query: AccountPlanQuery,
    response: AccountPlanResult,
  })
  @RequiresAny('account.view', 'account_plan.manage')
  accountPlan(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = AccountPlanQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.plans.get(tx, access, input.accountId, input.period),
    );
  }

  @Put('account-plans')
  @Contract({
    tag: 'Planning',
    summary: "Set an account's planned values for a month",
    body: PutAccountPlanBody,
    response: AccountPlanResult,
    idempotencyKey: true,
  })
  @Requires('account_plan.manage')
  putAccountPlan(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = PutAccountPlanBody.parse(body);
    return this.once(access, key, 'PUT /v1/account-plans', input, (tx) =>
      this.plans.put(tx, access, input),
    );
  }
}
