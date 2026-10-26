import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  type ApprovalSubject,
  capClaim,
  claimBase,
  claimIssues,
  type CreateExpenseClaimBody,
  type ExpenseClaimListQuery,
  type ExpenseClaimResult,
  type ExpenseIssue,
  issueAt,
  type MarkPaidBody,
  type PhotoKind,
  rateFor,
  receiptHoldsApproval,
  todayIn,
  scaled,
} from '@thelamp/shared';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { expenseClaims } from '../../db/schema/expenses';
import { users } from '../../db/schema/iam';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { ShiftsService } from '../field/shifts.service';
import { VisitsService } from '../field/visits.service';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { PhotosService } from '../media/photos.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { ApprovalsService } from '../workflow/approvals.service';
import { RequestTypes } from '../workflow/request-types';
import { ExpensePoliciesService } from './expense-policies.service';

type Row = typeof expenseClaims.$inferSelect;

/** Claims counted against caps: waiting, approved and paid (BR-29). */
const COUNTED = ['pending', 'approved', 'paid'];

const OWNER = 'expense_claim';

/** What each issue says beside its field (spec 11.1). */
const SAYS: Record<ExpenseIssue['issue'], string> = {
  inactive_policy: 'This expense policy is switched off',
  no_rate: 'This policy has no rate for your designation',
  future: 'Claim for a day that has passed or today',
  days_needed: 'Enter the days',
  readings_needed: 'Enter the opening and closing readings',
  closing_before_opening: 'The closing reading is below the opening one',
  odometer_photos: 'Add photos of the opening and closing readings',
  bill_needed: 'Enter the bill amount',
  no_visits: 'You completed no visits on this day',
  nothing_left: 'The caps for this day or month are used up',
};

/** The last day of a date's month. */
const monthEnd = (date: string) => {
  const [year, month] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

const invalid = (details: ReturnType<typeof issueAt>[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', details);

/**
 * Expense claims (M12, BR-29, BR-30, decision D83): a person claims against the policy version in
 * force on the day; the server works out the amount and the caps, attaches the receipts and
 * odometer photos, and starts the `expense` chain, which passes no step without a receipt where
 * the policy needs one. Receipts may follow while the claim waits; back office marks approved
 * claims paid.
 */
@Injectable()
export class ExpenseClaimsService implements OnModuleInit {
  constructor(
    private readonly policies: ExpensePoliciesService,
    private readonly approvals: ApprovalsService,
    private readonly requestTypes: RequestTypes,
    private readonly visits: VisitsService,
    private readonly shifts: ShiftsService,
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly photos: PhotosService,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  onModuleInit(): void {
    this.requestTypes.register({
      type: 'expense',
      fallbackPermission: 'approval.act',
      module: 'expenses',
      bulk: true,
      subjects: (tx, tenantId, ids) => this.subjects(tx, tenantId, ids),
      approvable: async (tx, tenantId, id) => {
        const row = await this.find(tx, tenantId, id);
        if (!row) return null;
        const policy = await this.policies.version(tx, tenantId, row.policyKey, row.policyVersion);
        const receipts = (await this.photos.ownedBy(tx, tenantId, OWNER, [id])).filter(
          (photo) => photo.kind === 'receipt',
        );
        return policy && receiptHoldsApproval(policy, receipts.length)
          ? 'This claim needs a receipt before anyone can approve it.'
          : null;
      },
      decided: async (tx, by, id, outcome) => {
        const [row] = await tx
          .update(expenseClaims)
          .set({ state: outcome, decidedAt: new Date() })
          .where(and(eq(expenseClaims.tenantId, by.tenantId), eq(expenseClaims.id, id)))
          .returning();
        if (!row) return;
        await this.audit.record(tx, by.tenantId, userActor(by), {
          action: 'expense.decided',
          target: { type: OWNER, id },
          after: { state: row.state },
        });
      },
    });
  }

  /** `POST /v1/expense-claims`: claims an expense for the caller (BR-29). */
  async create(
    tx: TenantTx,
    access: Access,
    body: CreateExpenseClaimBody,
  ): Promise<ExpenseClaimResult> {
    const { tenantId, userId } = access;
    const found = await this.policies.on(tx, tenantId, body.policy, body.expenseDate);
    if (!found) {
      throw invalid([issueAt(['policy'], 'There is no expense policy in force on this day')]);
    }
    const { policy, version } = found;
    // One claim at a time for a person, so two can't both fit under the same cap.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`expense:${tenantId}:${userId}`}, 0))`,
    );
    const settings = await this.config.settings(tx, tenantId);
    // A per-km claim may begin from a shift's punch readings and photos (decision D99).
    const fromShift = body.shiftId
      ? await this.fromShift(tx, access, body.shiftId, body.expenseDate, settings.timezone)
      : null;
    const odometerOpen = body.odometerOpen ?? fromShift?.start.reading;
    const odometerClose = body.odometerClose ?? fromShift?.end.reading;
    const odometerChanged =
      fromShift !== null &&
      (scaled(odometerOpen ?? '0', 1) !== scaled(fromShift.start.reading, 1) ||
        scaled(odometerClose ?? '0', 1) !== scaled(fromShift.end.reading, 1));
    const designation = (await this.people.facts(tx, tenantId, [userId])).get(userId)?.designation;
    const rate = policy.calculation === 'actual' ? null : rateFor(policy.rate, designation ?? '');
    const visits =
      policy.calculation === 'per_visit'
        ? (
            await this.visits.ofDay(tx, tenantId, userId, body.expenseDate, settings.timezone)
          ).filter((visit) => visit.checkOutAt !== null).length
        : undefined;
    const base = claimBase({
      calculation: policy.calculation,
      rate,
      odometerOpen,
      odometerClose,
      days: body.days,
      visits,
      billAmount: body.billAmount,
    });
    const capped = capClaim(base.amount, policy.caps, {
      day: await this.spent(tx, tenantId, userId, policy.key, body.expenseDate, body.expenseDate),
      month: await this.spent(
        tx,
        tenantId,
        userId,
        policy.key,
        `${body.expenseDate.slice(0, 7)}-01`,
        monthEnd(body.expenseDate),
      ),
    });
    const issues = claimIssues({
      policy,
      rate,
      expenseDate: body.expenseDate,
      today: todayIn(settings.timezone),
      days: body.days,
      odometerOpen,
      odometerClose,
      odometerPhotos: body.odometerPhotoIds.length + (fromShift?.photos ?? 0),
      billAmount: body.billAmount,
      visits,
      amount: capped.amount,
    });
    if (issues.length > 0) {
      throw invalid(issues.map((issue) => issueAt([issue.path], SAYS[issue.issue])));
    }
    await this.checkPhotos(tx, access, body.id, body.receiptIds, 'receipt', 'receiptIds');
    await this.checkPhotos(
      tx,
      access,
      body.id,
      body.odometerPhotoIds,
      'odometer',
      'odometerPhotoIds',
    );
    await tx.insert(expenseClaims).values({
      id: body.id,
      tenantId,
      userId,
      policyKey: policy.key,
      policyVersion: version,
      expenseDate: body.expenseDate,
      description: body.description,
      quantity: base.quantity,
      rate,
      odometerOpen: odometerOpen ?? null,
      odometerClose: odometerClose ?? null,
      shiftId: body.shiftId ?? null,
      odometerChanged,
      billAmount: body.billAmount ?? null,
      calculated: base.amount,
      amount: capped.amount,
      capped: capped.capped,
    });
    await this.photos.attach(tx, tenantId, [...body.receiptIds, ...body.odometerPhotoIds], {
      type: OWNER,
      id: body.id,
    });
    const approvalId = await this.approvals.request(
      tx,
      tenantId,
      userId,
      'expense',
      body.id,
      userActor(access),
      { facts: { amount: capped.amount, over_policy: capped.capped } },
    );
    await tx
      .update(expenseClaims)
      .set({ workflowInstanceId: approvalId })
      .where(and(eq(expenseClaims.tenantId, tenantId), eq(expenseClaims.id, body.id)));
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'expense.claimed',
      target: { type: OWNER, id: body.id },
      after: {
        policy: policy.key,
        version,
        expenseDate: body.expenseDate,
        calculated: base.amount,
        amount: capped.amount,
      },
    });
    return this.one(tx, tenantId, body.id);
  }

  /** `POST /v1/expense-claims/{id}/receipts`: more receipts on the caller's waiting claim. */
  async addReceipts(
    tx: TenantTx,
    access: Access,
    id: string,
    mediaIds: readonly string[],
  ): Promise<ExpenseClaimResult> {
    const row = await this.find(tx, access.tenantId, id);
    if (!row) throw notFound();
    if (row.userId !== access.userId) {
      throw new AppError('FORBIDDEN', 'Only the person who claimed adds receipts.');
    }
    if (row.state !== 'pending') {
      throw new AppError('CONFLICT', 'Receipts are added only while the claim waits.');
    }
    await this.checkPhotos(tx, access, id, mediaIds, 'receipt', 'mediaIds');
    await this.photos.attach(tx, access.tenantId, mediaIds, { type: OWNER, id });
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'expense.receipts_added',
      target: { type: OWNER, id },
      after: { mediaIds },
    });
    return this.one(tx, access.tenantId, id);
  }

  /** `POST /v1/expense-claims/{id}/paid`: back office has paid an approved claim. */
  async markPaid(
    tx: TenantTx,
    access: Access,
    id: string,
    body: MarkPaidBody,
  ): Promise<ExpenseClaimResult> {
    const row = await this.find(tx, access.tenantId, id);
    if (!row) throw notFound();
    if (!(await this.scopes.reaches(tx, access, row.userId))) throw outOfScope();
    if (row.state !== 'approved') {
      throw new AppError(
        'CONFLICT',
        row.state === 'paid' ? 'This claim is paid already.' : 'Only approved claims are paid.',
      );
    }
    await tx
      .update(expenseClaims)
      .set({
        state: 'paid',
        paidAt: new Date(),
        paidBy: access.userId,
        paymentReference: body.reference || null,
      })
      .where(and(eq(expenseClaims.tenantId, access.tenantId), eq(expenseClaims.id, id)));
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'expense.paid',
      target: { type: OWNER, id },
      before: { state: 'approved' },
      after: { state: 'paid', reference: body.reference ?? null },
    });
    return this.one(tx, access.tenantId, id);
  }

  /**
   * `GET /v1/expense-claims`: claims of the caller, a person they reach, or everyone they reach,
   * newest day first, a page at a time.
   */
  async list(
    tx: TenantTx,
    access: Access,
    query: ExpenseClaimListQuery,
  ): Promise<{ items: ExpenseClaimResult[]; nextCursor: string | null }> {
    if (
      query.userId &&
      query.userId !== access.userId &&
      !(await this.scopes.reaches(tx, access, query.userId))
    ) {
      throw outOfScope();
    }
    const [afterDate, afterId] = query.cursor?.split('|') ?? [];
    const rows = await tx
      .select({ claim: expenseClaims })
      .from(expenseClaims)
      .innerJoin(
        users,
        and(eq(users.tenantId, expenseClaims.tenantId), eq(users.id, expenseClaims.userId)),
      )
      .where(
        and(
          eq(expenseClaims.tenantId, access.tenantId),
          query.userId
            ? eq(expenseClaims.userId, query.userId)
            : await this.scopes.users(tx, access),
          query.period
            ? sql`to_char(${expenseClaims.expenseDate}, 'YYYY-MM') = ${query.period}`
            : undefined,
          query.state ? eq(expenseClaims.state, query.state) : undefined,
          afterDate && afterId
            ? sql`(${expenseClaims.expenseDate}, ${expenseClaims.id}) < (${afterDate}::date, ${afterId}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(expenseClaims.expenseDate), desc(expenseClaims.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit).map((row) => row.claim);
    const last = page.at(-1);
    return {
      items: await this.results(tx, access.tenantId, page),
      nextCursor: rows.length > query.limit && last ? `${last.expenseDate}|${last.id}` : null,
    };
  }

  /**
   * The expense register (M18): claims for days in a range by the people a subquery selects, by
   * day, a page at a time.
   */
  async register(
    tx: TenantTx,
    tenantId: string,
    people: SQL,
    from: string,
    to: string,
    offset: number,
    limit: number,
  ) {
    const rows = await tx
      .select()
      .from(expenseClaims)
      .where(
        and(
          eq(expenseClaims.tenantId, tenantId),
          sql`${expenseClaims.userId} in (${people})`,
          gte(expenseClaims.expenseDate, from),
          lte(expenseClaims.expenseDate, to),
        ),
      )
      .orderBy(expenseClaims.expenseDate, expenseClaims.userId, expenseClaims.id)
      .offset(offset)
      .limit(limit + 1);
    const photos = await this.photos.ownedBy(
      tx,
      tenantId,
      OWNER,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      ...row,
      receipts: photos.filter((photo) => photo.ownerId === row.id && photo.kind === 'receipt')
        .length,
    }));
  }

  /** What the person has claimed under a policy for days in a range, counted against caps. */
  private async spent(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    policy: string,
    from: string,
    to: string,
  ): Promise<string> {
    const [row] = await tx
      .select({ total: sql<string | null>`sum(${expenseClaims.amount})` })
      .from(expenseClaims)
      .where(
        and(
          eq(expenseClaims.tenantId, tenantId),
          eq(expenseClaims.userId, userId),
          eq(expenseClaims.policyKey, policy),
          inArray(expenseClaims.state, COUNTED),
          gte(expenseClaims.expenseDate, from),
          lte(expenseClaims.expenseDate, to),
        ),
      );
    return row?.total ?? '0';
  }

  /** The caller's shift a claim begins from: of the claim's day, with both readings in. */
  private async fromShift(
    tx: TenantTx,
    access: Access,
    shiftId: string,
    expenseDate: string,
    timezone: string,
  ) {
    const shift = await this.shifts.odometerFor(tx, access, shiftId, timezone);
    if (shift.date !== expenseDate) {
      throw invalid([issueAt(['shiftId'], 'This shift is from another day')]);
    }
    if (!shift.start || !shift.end) {
      throw invalid([issueAt(['shiftId'], 'This shift has no opening and closing readings')]);
    }
    return {
      start: shift.start,
      end: shift.end,
      photos: [shift.start.photoId, shift.end.photoId].filter((id) => id !== null).length,
    };
  }

  /** The caller's own photos of a kind, uploaded and not attached to another record. */
  private async checkPhotos(
    tx: TenantTx,
    access: Access,
    claimId: string,
    ids: readonly string[],
    kind: PhotoKind,
    path: string,
  ): Promise<void> {
    for (const id of ids) await this.photos.attachable(tx, access, id, kind);
    const found = await this.photos.forRecord(tx, access.tenantId, ids);
    const taken = found.filter((photo) => photo.ownerId !== null && photo.ownerId !== claimId);
    if (taken.length > 0) {
      throw invalid(
        taken.map((photo) =>
          issueAt([path, ids.indexOf(photo.id)], 'This photo belongs to another record'),
        ),
      );
    }
  }

  private async find(tx: TenantTx, tenantId: string, id: string): Promise<Row | undefined> {
    const [row] = await tx
      .select()
      .from(expenseClaims)
      .where(and(eq(expenseClaims.tenantId, tenantId), eq(expenseClaims.id, id)));
    return row;
  }

  private async one(tx: TenantTx, tenantId: string, id: string): Promise<ExpenseClaimResult> {
    const row = await this.find(tx, tenantId, id);
    if (!row) throw notFound();
    const [result] = await this.results(tx, tenantId, [row]);
    return result!;
  }

  private async results(
    tx: TenantTx,
    tenantId: string,
    rows: readonly Row[],
  ): Promise<ExpenseClaimResult[]> {
    if (rows.length === 0) return [];
    const photos = await this.photos.ownedBy(
      tx,
      tenantId,
      OWNER,
      rows.map((row) => row.id),
    );
    // A claim begun from a shift shows the shift's punch photos (decision D99).
    const shiftPhotos = await this.photos.ownedBy(
      tx,
      tenantId,
      'shift',
      rows.flatMap((row) => (row.shiftId ? [row.shiftId] : [])),
    );
    const people = await this.people.facts(
      tx,
      tenantId,
      rows.map((row) => row.userId),
    );
    const policies = new Map<string, Awaited<ReturnType<ExpensePoliciesService['version']>>>();
    for (const row of rows) {
      const key = `${row.policyKey}:${row.policyVersion}`;
      if (!policies.has(key)) {
        policies.set(
          key,
          await this.policies.version(tx, tenantId, row.policyKey, row.policyVersion),
        );
      }
    }
    return Promise.all(
      rows.map(async (row) => {
        const mine = photos.filter((photo) => photo.ownerId === row.id);
        const receipts = mine.filter((photo) => photo.kind === 'receipt');
        const policy = policies.get(`${row.policyKey}:${row.policyVersion}`);
        const person = people.get(row.userId);
        const flags = [
          ...(receipts.some((photo) => photo.duplicateOfId !== null) ? ['duplicate_receipt'] : []),
          ...(policy && receiptHoldsApproval(policy, receipts.length) ? ['receipt_missing'] : []),
          ...(row.capped ? ['capped'] : []),
          ...(row.odometerChanged ? ['odometer_changed'] : []),
        ];
        return {
          id: row.id,
          userId: row.userId,
          user: {
            id: row.userId,
            code: person?.code ?? '',
            name: person?.name ?? '',
          },
          policy: row.policyKey,
          policyVersion: row.policyVersion,
          expenseDate: row.expenseDate,
          description: row.description,
          quantity: row.quantity,
          rate: row.rate,
          odometerOpen: row.odometerOpen,
          odometerClose: row.odometerClose,
          billAmount: row.billAmount,
          calculated: row.calculated,
          amount: row.amount,
          capped: row.capped,
          receipts: receipts.map((photo) => photo.id),
          odometerPhotos: [...mine, ...shiftPhotos.filter((photo) => photo.ownerId === row.shiftId)]
            .filter((photo) => photo.kind === 'odometer')
            .map((photo) => photo.id),
          shiftId: row.shiftId,
          flags,
          state: row.state as ExpenseClaimResult['state'],
          approval: row.workflowInstanceId
            ? await this.approvals.forOwner(tx, tenantId, row.workflowInstanceId)
            : null,
          paidAt: row.paidAt?.toISOString() ?? null,
          paymentReference: row.paymentReference,
          createdAt: row.createdAt.toISOString(),
          decidedAt: row.decidedAt?.toISOString() ?? null,
        };
      }),
    );
  }

  /** What each claim is about, for the approvals inbox: its amount and description. */
  private async subjects(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, ApprovalSubject>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({
        id: expenseClaims.id,
        amount: expenseClaims.amount,
        description: expenseClaims.description,
      })
      .from(expenseClaims)
      .where(and(eq(expenseClaims.tenantId, tenantId), inArray(expenseClaims.id, [...ids])));
    return new Map(
      rows.map((row) => [row.id, { title: `${row.amount} · ${row.description}`, accountId: null }]),
    );
  }
}
