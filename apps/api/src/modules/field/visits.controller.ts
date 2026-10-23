import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CheckOutBody,
  CreateSubmissionBody,
  CurrentVisitResult,
  IdParams,
  StartVisitBody,
  SubmissionListQuery,
  SubmissionListResult,
  SubmissionResult,
  VisitResult,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { SubmissionsService } from './submissions.service';
import { VisitsService } from './visits.service';

const DEVICE_TIME = {
  name: 'X-Device-Time',
  description:
    "The phone's clock; records sent while it is over 10 minutes out are flagged (BR-44)",
};

/**
 * Visits and submissions (spec 11.2 Field group, M6). Both carry their own IDs and capture times,
 * so one sent again from the phone's outbox replays (BR-46) and one sent late from offline is
 * judged when it happened.
 */
@Controller('v1')
export class VisitsController {
  constructor(
    private readonly database: Database,
    private readonly visits: VisitsService,
    private readonly submissions: SubmissionsService,
  ) {}

  @Post('visits')
  @Contract({
    tag: 'Field',
    summary: 'Check in at an account',
    body: StartVisitBody,
    response: VisitResult,
    headers: [DEVICE_TIME],
  })
  @Requires('visit.use')
  @HttpCode(201)
  async checkIn(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('x-device-time') deviceTime: string | undefined,
  ) {
    const input = StartVisitBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `visit:${input.id}`,
        { route: 'POST /v1/visits', by: access.userId, input },
        async () => ({
          status: 201,
          body: await this.visits.checkIn(tx, access, input, deviceTime),
        }),
      ),
    );
    return result.body;
  }

  @Get('visits/current')
  @Contract({
    tag: 'Field',
    summary: "The caller's open visit, if any",
    response: CurrentVisitResult,
  })
  @Requires('visit.use')
  current(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, async (tx) => ({
      visit: await this.visits.current(tx, access),
    }));
  }

  @Post('visits/:id/check-out')
  @HttpCode(200)
  @Contract({
    tag: 'Field',
    summary: 'Check out of a visit',
    params: IdParams,
    body: CheckOutBody,
    response: VisitResult,
  })
  @Requires('visit.use')
  checkOut(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const visitId = pathId(id);
    const input = CheckOutBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.visits.checkOut(tx, access, visitId, input),
    );
  }

  @Post('submissions')
  @Contract({
    tag: 'Field',
    summary: 'Send a filled form',
    body: CreateSubmissionBody,
    response: SubmissionResult,
    headers: [DEVICE_TIME],
  })
  @Requires('submission.create')
  @HttpCode(201)
  async submit(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('x-device-time') deviceTime: string | undefined,
  ) {
    const input = CreateSubmissionBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `submission:${input.id}`,
        { route: 'POST /v1/submissions', by: access.userId, input },
        async () => ({
          status: 201,
          body: await this.submissions.create(tx, access, input, deviceTime),
        }),
      ),
    );
    return result.body;
  }

  @Get('submissions')
  @Contract({
    tag: 'Field',
    summary: "A person's or an account's submissions, newest first",
    query: SubmissionListQuery,
    response: SubmissionListResult,
  })
  @RequiresAny('submission.create', 'submission.review', 'user.view', 'account.view')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = SubmissionListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.submissions.list(tx, access, input),
    );
  }
}
