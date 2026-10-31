import { Injectable } from '@nestjs/common';
import {
  AppError,
  type ApprovalDelegation,
  type CreateDelegationBody,
  delegationActiveOn,
  delegationIssues,
  type DelegationCandidatesResult,
  type DelegationListQuery,
  type DelegationListResult,
  todayIn,
} from '@thelamp/shared';
import { and, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { approvalDelegations } from '../../db/schema/workflow';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

type Row = typeof approvalDelegations.$inferSelect;

/**
 * Approval delegations (M15, phase 4 step B1, decision D113): an approver away names a delegate
 * for some days. The approvals engine asks `delegatorsFor()` and `delegatesOf()` whenever it reads
 * an inbox, decides or notifies, so a delegation starts and ends with nothing to undo.
 */
@Injectable()
export class DelegationsService {
  constructor(
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  /** Today on the tenant's calendar, which delegations' days are counted in. */
  async today(tx: TenantTx, tenantId: string): Promise<string> {
    return todayIn((await this.config.settings(tx, tenantId)).timezone);
  }

  /** Who delegated to this person for a day: the approvers they stand in for. */
  async delegatorsFor(
    tx: TenantTx,
    tenantId: string,
    delegateId: string,
    day: string,
  ): Promise<string[]> {
    const rows = await tx
      .select({ id: approvalDelegations.delegatorId })
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.tenantId, tenantId),
          eq(approvalDelegations.delegateId, delegateId),
          lte(approvalDelegations.startsOn, day),
          gte(approvalDelegations.endsOn, day),
          isNull(approvalDelegations.endedAt),
        ),
      );
    return rows.map((row) => row.id);
  }

  /** Each of these approvers' delegate for a day, by approver; one hop only. */
  async delegatesOf(
    tx: TenantTx,
    tenantId: string,
    approverIds: readonly string[],
    day: string,
  ): Promise<Map<string, string>> {
    if (approverIds.length === 0) return new Map();
    const rows = await tx
      .select({ from: approvalDelegations.delegatorId, to: approvalDelegations.delegateId })
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.tenantId, tenantId),
          inArray(approvalDelegations.delegatorId, [...approverIds]),
          lte(approvalDelegations.startsOn, day),
          gte(approvalDelegations.endsOn, day),
          isNull(approvalDelegations.endedAt),
        ),
      );
    return new Map(rows.map((row) => [row.from, row.to]));
  }

  /** Whose delegations a caller asks about: their own, or someone their scope reaches. */
  private async subject(tx: TenantTx, access: Access, userId: string | undefined) {
    const id = userId ?? access.userId;
    if (id === access.userId) return id;
    if (!access.permissions.has('user.manage')) {
      throw new AppError('FORBIDDEN', 'You may set delegations only for yourself.');
    }
    if (!(await this.scopes.reaches(tx, access, id))) {
      const exists = await this.people.facts(tx, access.tenantId, [id]);
      throw exists.has(id) ? outOfScope() : notFound();
    }
    return id;
  }

  private async views(tx: TenantTx, tenantId: string, rows: readonly Row[]) {
    const today = await this.today(tx, tenantId);
    const people = await this.people.facts(
      tx,
      tenantId,
      rows.flatMap((row) => [row.delegatorId, row.delegateId]),
    );
    const ref = (id: string) => {
      const person = people.get(id);
      return { id, code: person?.code ?? '', name: person?.name ?? '' };
    };
    return rows.map((row): ApprovalDelegation => ({
      id: row.id,
      delegator: ref(row.delegatorId),
      delegate: ref(row.delegateId),
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      note: row.note,
      state:
        row.endedAt !== null
          ? 'ended'
          : row.endsOn < today
            ? 'over'
            : delegationActiveOn({ ...row, endedAt: null }, today)
              ? 'active'
              : 'upcoming',
      endedAt: row.endedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** A person's delegations, given and received, newest first. */
  async list(
    tx: TenantTx,
    access: Access,
    query: DelegationListQuery,
  ): Promise<DelegationListResult> {
    const userId = await this.subject(tx, access, query.userId);
    const rows = await tx
      .select()
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.tenantId, access.tenantId),
          or(
            eq(approvalDelegations.delegatorId, userId),
            eq(approvalDelegations.delegateId, userId),
          ),
        ),
      )
      .orderBy(desc(approvalDelegations.startsOn), desc(approvalDelegations.id))
      .limit(50);
    return { items: await this.views(tx, access.tenantId, rows) };
  }

  /** The active people who may approve, to choose a delegate from. */
  async candidates(tx: TenantTx, access: Access): Promise<DelegationCandidatesResult> {
    const found = await this.people.withPermission(tx, access.tenantId, 'approval.act');
    return { items: found.map(({ id, code, name }) => ({ id, code, name })) };
  }

  /** Names a delegate for some days, after `delegationIssues()` (D113); audited. */
  async create(
    tx: TenantTx,
    access: Access,
    body: CreateDelegationBody,
  ): Promise<ApprovalDelegation> {
    const tenantId = access.tenantId;
    const delegatorId = await this.subject(tx, access, body.delegatorId);
    const today = await this.today(tx, tenantId);
    const delegate = (await this.people.facts(tx, tenantId, [body.delegateId])).get(
      body.delegateId,
    );
    const mayApprove = delegate
      ? (await this.people.withPermission(tx, tenantId, 'approval.act')).some(
          (person) => person.id === delegate.id,
        )
      : false;
    const others = await tx
      .select()
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.tenantId, tenantId),
          eq(approvalDelegations.delegatorId, delegatorId),
          gte(approvalDelegations.endsOn, today),
        ),
      );
    const issues = delegationIssues({
      delegatorId,
      delegateId: body.delegateId,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      today,
      delegate: delegate ? { active: delegate.status === 'active', mayApprove } : null,
      others: others.map((row) => ({
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        endedAt: row.endedAt?.toISOString() ?? null,
      })),
    });
    if (issues.length > 0) throw new AppError('VALIDATION', 'Check the delegation.', issues);
    const [row] = await tx
      .insert(approvalDelegations)
      .values({
        id: body.id,
        tenantId,
        delegatorId,
        delegateId: body.delegateId,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
        note: body.note ?? null,
        createdBy: access.userId ?? null,
      })
      .returning();
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'approval.delegated',
      target: { type: 'user', id: delegatorId },
      after: {
        delegateId: body.delegateId,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
      },
    });
    return (await this.views(tx, tenantId, [row!]))[0]!;
  }

  /** Ends a delegation early: by its delegator, or someone whose scope reaches them. */
  async end(tx: TenantTx, access: Access, id: string): Promise<ApprovalDelegation> {
    const tenantId = access.tenantId;
    const [row] = await tx
      .select()
      .from(approvalDelegations)
      .where(and(eq(approvalDelegations.tenantId, tenantId), eq(approvalDelegations.id, id)))
      .for('update');
    if (!row) throw notFound();
    await this.subject(tx, access, row.delegatorId);
    if (row.endedAt !== null) return (await this.views(tx, tenantId, [row]))[0]!;
    const [ended] = await tx
      .update(approvalDelegations)
      .set({ endedAt: new Date(), endedBy: access.userId ?? null })
      .where(and(eq(approvalDelegations.tenantId, tenantId), eq(approvalDelegations.id, id)))
      .returning();
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'approval.delegation_ended',
      target: { type: 'user', id: row.delegatorId },
      before: { delegateId: row.delegateId, startsOn: row.startsOn, endsOn: row.endsOn },
    });
    return (await this.views(tx, tenantId, [ended!]))[0]!;
  }
}
