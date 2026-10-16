import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  autoApprovable,
  type BulkReviewBody,
  type BulkReviewResult,
  integrityWarning,
  newId,
  type ReviewBody,
  type ReviewEntry,
  type ReviewItem,
  ReviewQueueQuery,
  type ReviewQueueResult,
  reviewRefusal,
  REVIEW_NOTE_MIN,
} from '@kshetra/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { submissionReviews } from '../../db/schema/review';
import { type AuditActor, AuditLog, SYSTEM_ACTOR, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { SubmissionsService } from '../field/submissions.service';
import { DevicesService } from '../iam/devices.service';
import { People } from '../iam/people';
import { PhotosService } from '../media/photos.service';

type Decided = Awaited<ReturnType<SubmissionsService['forDecision']>>;

/** How often auto-approval looks for submissions whose wait is over (M7). */
const AUTO_APPROVAL_EVERY_MS = 15 * 60_000;

/**
 * Evidence review (M7): the queue of submissions reviewers in scope decide, single and bulk
 * decisions, and auto-approval for forms that allow it. Every decision is kept, audited and
 * published, so metrics and plan items follow it; the submission's status is the latest.
 */
@Injectable()
export class ReviewService implements OnModuleInit {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly submissions: SubmissionsService,
    private readonly photos: PhotosService,
    private readonly devices: DevicesService,
    private readonly people: People,
  ) {}

  onModuleInit(): void {
    this.queues.handle('maintenance', 'review.auto_approve', (data) =>
      this.autoApprove(String(data.tenantId), new Date(String(data.at))).then(() => undefined),
    );
    this.schedules.everyForTenants({
      name: 'review_auto_approve',
      everyMs: AUTO_APPROVAL_EVERY_MS,
      queue: 'maintenance',
      kind: 'review.auto_approve',
    });
  }

  /** The queue (M7), each submission with its photos, device warning and decisions so far. */
  async queue(
    tx: TenantTx,
    access: Access,
    query: ReviewQueueQuery,
    only?: string,
  ): Promise<ReviewQueueResult> {
    const tenantId = access.tenantId;
    const { rows, nextCursor } = await this.submissions.reviewRows(tx, access, query, only);
    const ids = rows.map((row) => row.id);
    const photos = await this.photos.forReview(
      tx,
      tenantId,
      'submission',
      rows.map((row) => ({ id: row.id, at: row.location })),
    );
    const verdicts = await this.devices.verdicts(
      tx,
      tenantId,
      rows.flatMap((row) => (row.deviceId ? [row.deviceId] : [])),
    );
    const reviews = await this.reviewsOf(tx, tenantId, ids);
    const items: ReviewItem[] = rows.map(({ deviceId, autoApproveAt, ...row }) => ({
      ...row,
      photoDetails: photos.get(row.id) ?? [],
      integrityWarning: integrityWarning(deviceId ? (verdicts.get(deviceId) ?? null) : null),
      autoApproveAt: autoApproveAt?.toISOString() ?? null,
      reviews: reviews.get(row.id) ?? [],
    }));
    return { items, nextCursor };
  }

  /** Every decision on these submissions, oldest first, with who made it. */
  private async reviewsOf(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, ReviewEntry[]>> {
    const found = new Map<string, ReviewEntry[]>();
    if (ids.length === 0) return found;
    const rows = await tx
      .select()
      .from(submissionReviews)
      .where(
        and(
          eq(submissionReviews.tenantId, tenantId),
          inArray(submissionReviews.submissionId, [...ids]),
        ),
      )
      .orderBy(asc(submissionReviews.createdAt), asc(submissionReviews.id));
    const reviewers = await this.people.facts(tx, tenantId, [
      ...new Set(rows.flatMap((row) => (row.reviewerId ? [row.reviewerId] : []))),
    ]);
    for (const row of rows) {
      const list = found.get(row.submissionId) ?? [];
      list.push({
        decision: row.decision,
        note: row.note,
        reviewer: row.reviewerId
          ? { id: row.reviewerId, name: reviewers.get(row.reviewerId)?.name ?? '' }
          : null,
        auto: row.auto,
        at: row.createdAt.toISOString(),
      });
      found.set(row.submissionId, list);
    }
    return found;
  }

  /**
   * Approve, or reject with a note (M7). Nobody reviews their own work; changing a decision needs
   * a note; deciding what was already decided changes nothing.
   */
  async decide(tx: TenantTx, access: Access, id: string, body: ReviewBody): Promise<ReviewItem> {
    const submission = await this.submissions.forDecision(tx, access, id);
    const note = body.note?.trim() || null;
    const refusal = reviewRefusal({
      reviewerId: access.userId,
      authorId: submission.userId,
      current: submission.status,
      decision: body.decision,
      note,
    });
    if (refusal === 'OWN_WORK') {
      throw new AppError('FORBIDDEN', 'Nobody reviews their own work.');
    }
    if (refusal === 'NOTE_REQUIRED') {
      throw new AppError('VALIDATION', 'Say why, in a few words.', [
        { path: 'note', issue: `Write at least ${REVIEW_NOTE_MIN} characters` },
      ]);
    }
    if (refusal !== 'UNCHANGED') {
      await this.record(tx, access.tenantId, userActor(access), submission, {
        decision: body.decision,
        note,
        reviewerId: access.userId,
        auto: false,
      });
    }
    return this.item(tx, access, id);
  }

  /** The submission as the queue shows it, whatever its status now. */
  private async item(tx: TenantTx, access: Access, id: string): Promise<ReviewItem> {
    const { items } = await this.queue(tx, access, ReviewQueueQuery.parse({}), id);
    return items[0]!;
  }

  /**
   * Approves many submissions at once (M7): only pending ones without flags, of people in the
   * caller's scope and never the caller's own. Each one skipped says why.
   */
  async bulk(tx: TenantTx, access: Access, body: BulkReviewBody): Promise<BulkReviewResult> {
    const approved: string[] = [];
    const skipped: BulkReviewResult['skipped'] = [];
    for (const id of [...new Set(body.ids)]) {
      let submission: Decided;
      try {
        submission = await this.submissions.forDecision(tx, access, id);
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === 'NOT_FOUND' || error.code === 'OUT_OF_SCOPE')
        ) {
          skipped.push({ id, reason: error.code });
          continue;
        }
        throw error;
      }
      if (submission.userId === access.userId) skipped.push({ id, reason: 'OWN_WORK' });
      else if (submission.status !== 'pending') skipped.push({ id, reason: 'NOT_PENDING' });
      else if (submission.flags.length > 0) skipped.push({ id, reason: 'FLAGGED' });
      else {
        await this.record(tx, access.tenantId, userActor(access), submission, {
          decision: 'approved',
          note: null,
          reviewerId: access.userId,
          auto: false,
        });
        approved.push(id);
      }
    }
    return { approved, skipped };
  }

  /**
   * Approves submissions whose auto-approval wait is over (M7): still pending, still without
   * flags, not outside the geofence, from a device without integrity warnings. One that no longer
   * qualifies waits for a person. Returns how many it approved.
   */
  async autoApprove(tenantId: string, now: Date = new Date()): Promise<number> {
    const approved = await this.database.forTenant(tenantId, async (tx) => {
      const due = await this.submissions.dueForAutoApproval(tx, tenantId, now);
      const verdicts = await this.devices.verdicts(
        tx,
        tenantId,
        due.flatMap((row) => (row.deviceId ? [row.deviceId] : [])),
      );
      let count = 0;
      for (const submission of due) {
        const verdict = submission.deviceId ? (verdicts.get(submission.deviceId) ?? null) : null;
        if (
          !autoApprovable({
            flags: submission.flags,
            geofence: submission.geofence,
            integrityVerdict: verdict,
          })
        ) {
          await this.submissions.stopAutoApproval(tx, tenantId, submission.id);
          continue;
        }
        await this.record(
          tx,
          tenantId,
          SYSTEM_ACTOR,
          { ...submission, status: 'pending' },
          { decision: 'approved', note: null, reviewerId: null, auto: true },
        );
        count += 1;
      }
      return count;
    });
    if (approved > 0) this.logger.log(`Tenant ${tenantId}: ${approved} submissions auto-approved.`);
    return approved;
  }

  /** Keeps a decision, moves the submission to it, audits it and tells who follows it. */
  private async record(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    submission: Pick<
      Decided,
      'id' | 'userId' | 'status' | 'formKey' | 'accountId' | 'visitId' | 'capturedAt'
    >,
    decision: {
      decision: 'approved' | 'rejected';
      note: string | null;
      reviewerId: string | null;
      auto: boolean;
    },
  ): Promise<void> {
    const reviewId = newId();
    await tx.insert(submissionReviews).values({
      id: reviewId,
      tenantId,
      submissionId: submission.id,
      decision: decision.decision,
      note: decision.note,
      reviewerId: decision.reviewerId,
      auto: decision.auto,
    });
    await this.submissions.setStatus(tx, tenantId, submission.id, decision.decision, decision.auto);
    await this.audit.record(tx, tenantId, actor, {
      action: 'submission.reviewed',
      target: { type: 'submission', id: submission.id },
      before: { status: submission.status },
      after: { status: decision.decision, note: decision.note, auto: decision.auto },
    });
    await this.outbox.publish(tx, tenantId, 'submission.reviewed', reviewId, {
      submissionId: submission.id,
      userId: submission.userId,
      formKey: submission.formKey,
      accountId: submission.accountId,
      visitId: submission.visitId,
      capturedAt: submission.capturedAt.toISOString(),
      before: submission.status,
      status: decision.decision,
      auto: decision.auto,
      reviewerId: decision.reviewerId,
      note: decision.note,
    });
  }
}
