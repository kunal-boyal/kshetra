import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';
import { submissions } from './field';
import { users } from './iam';

/**
 * Review decisions on submissions (M7, spec 10.3), owned by the review module: every decision a
 * person or the auto-approval made, kept so a change of mind shows what it changed. The
 * submission's own status is the latest of them.
 */
export const reviewDecision = cell.enum('review_decision', ['approved', 'rejected']);

export const submissionReviews = cell
  .table(
    'submission_reviews',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      submissionId: uuid('submission_id').notNull(),
      decision: reviewDecision('decision').notNull(),
      note: text('note'),
      /** Null for the auto-approval. */
      reviewerId: uuid('reviewer_id'),
      auto: boolean('auto').notNull().default(false),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('submission_reviews_tenant_submission').on(
        table.tenantId,
        table.submissionId,
        table.createdAt,
      ),
      index('submission_reviews_tenant_reviewer')
        .on(table.tenantId, table.reviewerId, table.createdAt)
        .where(sql`${table.reviewerId} is not null`),
      foreignKey({
        name: 'submission_reviews_submission_fk',
        columns: [table.tenantId, table.submissionId],
        foreignColumns: [submissions.tenantId, submissions.id],
      }),
      foreignKey({
        name: 'submission_reviews_reviewer_fk',
        columns: [table.tenantId, table.reviewerId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
