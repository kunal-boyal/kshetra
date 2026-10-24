import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  type ApprovalSubject,
  type CreateRegularisationBody,
  issueAt,
  type RegularisationListQuery,
  type RegularisationResult,
  regularisationIssue,
  todayIn,
} from '@thelamp/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { regularisations } from '../../db/schema/attendance';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { notFound, outOfScope, uniqueViolation } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { ApprovalsService } from '../workflow/approvals.service';
import { RequestTypes } from '../workflow/request-types';
import { AttendanceService } from './attendance.service';

type Row = typeof regularisations.$inferSelect;

const invalid = (path: string, issue: string) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', [issueAt([path], issue)]);

/**
 * Regularisation (M13, BR-28, decision D80): a person asks to count a past day as present or a
 * half day, with a reason, one waiting or approved request a day, through the `regularisation`
 * chain. An approved request makes the day present or half (BR-23), and the stored day follows.
 */
@Injectable()
export class RegularisationsService implements OnModuleInit {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly types: RequestTypes,
    private readonly attendance: AttendanceService,
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  onModuleInit(): void {
    this.types.register({
      type: 'regularisation',
      fallbackPermission: 'approval.act',
      module: 'leave_attendance',
      bulk: true,
      subjects: (tx, tenantId, ids) => this.subjects(tx, tenantId, ids),
      decided: async (tx, by, id, outcome) => {
        const [row] = await tx
          .update(regularisations)
          .set({
            state: outcome === 'approved' ? 'approved' : outcome,
            decidedAt: new Date(),
          })
          .where(and(eq(regularisations.tenantId, by.tenantId), eq(regularisations.id, id)))
          .returning();
        if (!row) return;
        await this.audit.record(tx, by.tenantId, userActor(by), {
          action: 'regularisation.decided',
          target: { type: 'regularisation', id },
          after: { state: row.state },
        });
        // The stored day follows, for reports.
        await this.attendance.store(tx, by.tenantId, [row.userId], row.date);
      },
    });
  }

  /** `POST /v1/regularisations`: asks to fix one of the caller's own past days. */
  async create(
    tx: TenantTx,
    access: Access,
    body: CreateRegularisationBody,
  ): Promise<RegularisationResult> {
    const { tenantId } = access;
    const [mine] = await this.people.employment(tx, tenantId, [access.userId]);
    const { timezone } = await this.config.settings(tx, tenantId);
    const today = todayIn(timezone);
    const issue = regularisationIssue(body.date, today, mine?.joiningDate ?? null);
    if (issue === 'future') throw invalid('date', 'Ask about a day that has passed');
    if (issue === 'before_joining') throw invalid('date', 'This is before you joined');
    try {
      await tx.transaction((inner) =>
        inner.insert(regularisations).values({
          id: body.id,
          tenantId,
          userId: access.userId,
          date: body.date,
          status: body.status,
          reason: body.reason,
        }),
      );
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new AppError('CONFLICT', 'You have asked about this day already.', [
          issueAt(['date'], 'You have asked about this day already'),
        ]);
      }
      throw error;
    }
    const daysAgo = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${body.date}T00:00:00Z`)) / 86_400_000,
    );
    const approvalId = await this.approvals.request(
      tx,
      tenantId,
      access.userId,
      'regularisation',
      body.id,
      userActor(access),
      { facts: { days_ago: daysAgo } },
    );
    await tx
      .update(regularisations)
      .set({ workflowInstanceId: approvalId })
      .where(and(eq(regularisations.tenantId, tenantId), eq(regularisations.id, body.id)));
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'regularisation.requested',
      target: { type: 'regularisation', id: body.id },
      after: { date: body.date, status: body.status },
    });
    return this.result(tx, tenantId, await this.row(tx, tenantId, body.id));
  }

  /** `GET /v1/regularisations`: a person's requests in a month, theirs or someone they reach. */
  async list(
    tx: TenantTx,
    access: Access,
    query: RegularisationListQuery,
  ): Promise<{ items: RegularisationResult[] }> {
    const userId = query.userId ?? access.userId;
    if (userId !== access.userId && !(await this.scopes.reaches(tx, access, userId))) {
      throw outOfScope();
    }
    const rows = await tx
      .select()
      .from(regularisations)
      .where(
        and(
          eq(regularisations.tenantId, access.tenantId),
          eq(regularisations.userId, userId),
          sql`to_char(${regularisations.date}, 'YYYY-MM') = ${query.period}`,
        ),
      )
      .orderBy(asc(regularisations.date), asc(regularisations.createdAt));
    return { items: await Promise.all(rows.map((row) => this.result(tx, access.tenantId, row))) };
  }

  private async row(tx: TenantTx, tenantId: string, id: string): Promise<Row> {
    const [row] = await tx
      .select()
      .from(regularisations)
      .where(and(eq(regularisations.tenantId, tenantId), eq(regularisations.id, id)));
    if (!row) throw notFound();
    return row;
  }

  private async result(tx: TenantTx, tenantId: string, row: Row): Promise<RegularisationResult> {
    return {
      id: row.id,
      userId: row.userId,
      date: row.date,
      status: row.status as RegularisationResult['status'],
      reason: row.reason,
      state: row.state as RegularisationResult['state'],
      approval: row.workflowInstanceId
        ? await this.approvals.forOwner(tx, tenantId, row.workflowInstanceId)
        : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** What each request is about, for the approvals inbox: the day. */
  private async subjects(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, ApprovalSubject>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: regularisations.id, date: regularisations.date })
      .from(regularisations)
      .where(and(eq(regularisations.tenantId, tenantId), inArray(regularisations.id, [...ids])));
    return new Map(rows.map((row) => [row.id, { title: row.date, accountId: null }]));
  }
}
