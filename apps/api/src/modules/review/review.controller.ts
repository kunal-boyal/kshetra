import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  BulkReviewBody,
  BulkReviewResult,
  IdParams,
  ReviewBody,
  ReviewItem,
  ReviewQueueQuery,
  ReviewQueueResult,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { ReviewService } from './review.service';

/**
 * Evidence review (spec 11.2 Review group, M7). Decisions carry an `Idempotency-Key`, so one
 * sent twice is applied once (BR-46).
 */
@Controller('v1')
export class ReviewController {
  constructor(
    private readonly database: Database,
    private readonly review: ReviewService,
  ) {}

  @Get('reviews/queue')
  @Contract({
    tag: 'Review',
    summary: 'Submissions to review, of people in scope, newest first',
    query: ReviewQueueQuery,
    response: ReviewQueueResult,
  })
  @Requires('submission.review')
  queue(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = ReviewQueueQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.review.queue(tx, access, input));
  }

  @Post('submissions/:id/review')
  @HttpCode(200)
  @Contract({
    tag: 'Review',
    summary: 'Approve or reject a submission, or change the decision with a note',
    params: IdParams,
    body: ReviewBody,
    response: ReviewItem,
    idempotencyKey: true,
  })
  @Requires('submission.review')
  async decide(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const submissionId = pathId(id);
    const input = ReviewBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/submissions/:id/review', by: access.userId, submissionId, input },
        async () => ({
          status: 200,
          body: await this.review.decide(tx, access, submissionId, input),
        }),
      ),
    );
    return result.body;
  }

  @Post('reviews/bulk')
  @HttpCode(200)
  @Contract({
    tag: 'Review',
    summary: 'Approve many submissions without flags at once',
    body: BulkReviewBody,
    response: BulkReviewResult,
    idempotencyKey: true,
  })
  @Requires('submission.review_bulk')
  async bulk(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = BulkReviewBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/reviews/bulk', by: access.userId, input },
        async () => ({ status: 200, body: await this.review.bulk(tx, access, input) }),
      ),
    );
    return result.body;
  }
}
