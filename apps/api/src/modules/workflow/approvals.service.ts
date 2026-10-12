import { Injectable } from '@nestjs/common';
import {
  AppError,
  type ApprovalDecisionBody,
  type ApprovalInboxQuery,
  type ApprovalInboxResult,
  type ApprovalResult,
  newId,
  type RequestType,
} from '@kshetra/shared';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { workflowInstances, workflowSteps } from '../../db/schema/workflow';
import { type AuditActor, AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { RequestTypes } from './request-types';

type Instance = typeof workflowInstances.$inferSelect;
type Step = typeof workflowSteps.$inferSelect;

/**
 * Approvals (spec 5.9, M15), as phase 1 needs them: one step, decided by the requester's manager,
 * or by whoever may decide across the tenant when the requester has no active manager (decision
 * D38). Phase 2's engine resolves configured chains into the same instances and steps.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly people: People,
    private readonly types: RequestTypes,
    private readonly audit: AuditLog,
  ) {}

  /**
   * Starts the approval of a request, in the transaction that makes it. Refused when nobody could
   * ever decide it. Returns the instance's ID.
   */
  async request(
    tx: TenantTx,
    tenantId: string,
    requesterId: string,
    type: RequestType,
    requestId: string,
    actor: AuditActor,
  ): Promise<string> {
    const requester = (await this.people.facts(tx, tenantId, [requesterId])).get(requesterId);
    if (!requester) throw notFound();
    const manager = requester.managerId
      ? (await this.people.facts(tx, tenantId, [requester.managerId])).get(requester.managerId)
      : undefined;
    // Nobody approves their own request (BR-31).
    const approvers =
      manager && manager.status === 'active' && manager.id !== requesterId
        ? [manager.id]
        : await this.people.holding(
            tx,
            tenantId,
            this.types.get(type).fallbackPermission,
            requesterId,
          );
    if (approvers.length === 0) {
      throw new AppError('CONFLICT', 'Nobody can approve this yet. Ask an admin to set a manager.');
    }
    const id = newId();
    await tx.insert(workflowInstances).values({
      id,
      tenantId,
      requestType: type,
      requestId,
      requesterId,
    });
    await tx.insert(workflowSteps).values({
      tenantId,
      instanceId: id,
      stepIndex: 0,
      approverIds: approvers,
      status: 'pending',
    });
    await this.audit.record(tx, tenantId, actor, {
      action: 'approval.requested',
      target: { type: 'approval', id },
      after: { requestType: type, requestId, approvers },
    });
    return id;
  }

  /** The pending approval of a request, if one waits. */
  async pendingFor(
    tx: TenantTx,
    tenantId: string,
    type: RequestType,
    requestId: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ id: workflowInstances.id })
      .from(workflowInstances)
      .where(
        and(
          eq(workflowInstances.tenantId, tenantId),
          eq(workflowInstances.requestType, type),
          eq(workflowInstances.requestId, requestId),
          eq(workflowInstances.status, 'pending'),
        ),
      );
    return row?.id ?? null;
  }

  /** What waits for the caller, oldest first. */
  async inbox(
    tx: TenantTx,
    access: Access,
    query: ApprovalInboxQuery,
  ): Promise<ApprovalInboxResult> {
    const found = await tx
      .select({ instance: workflowInstances })
      .from(workflowInstances)
      .innerJoin(
        workflowSteps,
        and(
          eq(workflowSteps.tenantId, workflowInstances.tenantId),
          eq(workflowSteps.instanceId, workflowInstances.id),
          eq(workflowSteps.stepIndex, workflowInstances.currentStep),
        ),
      )
      .where(
        and(
          eq(workflowInstances.tenantId, access.tenantId),
          eq(workflowInstances.status, 'pending'),
          eq(workflowSteps.status, 'pending'),
          sql`${access.userId}::uuid = any(${workflowSteps.approverIds})`,
          query.requestType ? eq(workflowInstances.requestType, query.requestType) : undefined,
          query.cursor ? gt(workflowInstances.id, query.cursor) : undefined,
        ),
      )
      .orderBy(asc(workflowInstances.id))
      .limit(query.limit + 1);
    const page = found.slice(0, query.limit).map((row) => row.instance);
    return {
      items: await this.results(tx, access.tenantId, page),
      nextCursor: found.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  /** One request, for its requester and the people asked to decide it. */
  async get(tx: TenantTx, access: Access, id: string): Promise<ApprovalResult> {
    const instance = await this.find(tx, access.tenantId, id);
    const steps = await this.steps(tx, access.tenantId, [id]);
    const involved =
      instance.requesterId === access.userId ||
      steps.some((step) => step.approverIds.includes(access.userId));
    if (!involved) throw outOfScope();
    const [result] = await this.results(tx, access.tenantId, [instance]);
    return result!;
  }

  /**
   * A decision on the current step (BR-31): only its approvers act, nobody acts on their own
   * request, and a decision made on an older version is refused, so when two approvers act at once
   * one decision is saved and the other gets 409.
   */
  async decide(
    tx: TenantTx,
    access: Access,
    id: string,
    body: ApprovalDecisionBody,
  ): Promise<ApprovalResult> {
    const instance = await this.find(tx, access.tenantId, id, true);
    if (instance.requesterId === access.userId) {
      throw new AppError('FORBIDDEN', 'Nobody decides their own request.');
    }
    const [step] = (await this.steps(tx, access.tenantId, [id])).filter(
      (entry) => entry.stepIndex === instance.currentStep,
    );
    const approver = step?.approverIds.includes(access.userId) ?? false;
    if (instance.status !== 'pending' || instance.version !== body.version) {
      if (!approver && instance.status === 'pending') throw this.notCurrent();
      throw new AppError('CONFLICT', 'This request was decided or changed. Refresh the inbox.');
    }
    if (!step || !approver || step.status !== 'pending') throw this.notCurrent();
    const outcome = body.decision === 'approve' ? 'approved' : 'rejected';
    const now = new Date();
    await tx
      .update(workflowSteps)
      .set({ status: outcome, actedBy: access.userId, actedAt: now, note: body.note ?? null })
      .where(
        and(
          eq(workflowSteps.tenantId, access.tenantId),
          eq(workflowSteps.instanceId, id),
          eq(workflowSteps.stepIndex, step.stepIndex),
        ),
      );
    const [closed] = await tx
      .update(workflowInstances)
      .set({ status: outcome, version: instance.version + 1, closedAt: now })
      .where(and(eq(workflowInstances.tenantId, access.tenantId), eq(workflowInstances.id, id)))
      .returning();
    await this.types.get(instance.requestType).decided(tx, access, instance.requestId, outcome);
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'approval.decided',
      target: { type: 'approval', id },
      before: { status: instance.status },
      after: { status: outcome, note: body.note ?? null },
    });
    const [result] = await this.results(tx, access.tenantId, [closed!]);
    return result!;
  }

  private notCurrent(): AppError {
    return new AppError(
      'NOT_CURRENT_APPROVER',
      'Someone else decides this step. Refresh the inbox.',
    );
  }

  private async find(tx: TenantTx, tenantId: string, id: string, lock = false): Promise<Instance> {
    const query = tx
      .select()
      .from(workflowInstances)
      .where(and(eq(workflowInstances.tenantId, tenantId), eq(workflowInstances.id, id)));
    const [instance] = lock ? await query.for('update') : await query;
    if (!instance) throw notFound();
    return instance;
  }

  private steps(tx: TenantTx, tenantId: string, ids: readonly string[]): Promise<Step[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return tx
      .select()
      .from(workflowSteps)
      .where(and(eq(workflowSteps.tenantId, tenantId), inArray(workflowSteps.instanceId, [...ids])))
      .orderBy(asc(workflowSteps.stepIndex));
  }

  private async results(
    tx: TenantTx,
    tenantId: string,
    instances: readonly Instance[],
  ): Promise<ApprovalResult[]> {
    const steps = await this.steps(
      tx,
      tenantId,
      instances.map((instance) => instance.id),
    );
    const people = await this.people.facts(tx, tenantId, [
      ...instances.map((instance) => instance.requesterId),
      ...steps.flatMap((step) => [...step.approverIds, ...(step.actedBy ? [step.actedBy] : [])]),
    ]);
    const ref = (id: string) => {
      const person = people.get(id);
      return { id, code: person?.code ?? '', name: person?.name ?? '' };
    };
    // Each module describes its own requests, one query per type.
    const subjects = new Map<string, ApprovalResult['subject']>();
    for (const type of new Set(instances.map((instance) => instance.requestType))) {
      const ids = instances
        .filter((instance) => instance.requestType === type)
        .map((instance) => instance.requestId);
      for (const [requestId, subject] of await this.types.get(type).subjects(tx, tenantId, ids)) {
        subjects.set(`${type}:${requestId}`, subject);
      }
    }
    return instances.map((instance) => ({
      id: instance.id,
      requestType: instance.requestType,
      requestId: instance.requestId,
      subject: subjects.get(`${instance.requestType}:${instance.requestId}`) ?? {
        title: '',
        accountId: null,
      },
      requester: ref(instance.requesterId),
      status: instance.status,
      version: instance.version,
      steps: steps
        .filter((step) => step.instanceId === instance.id)
        .map((step) => ({
          index: step.stepIndex,
          approvers: step.approverIds.map(ref),
          status: step.status,
          actedBy: step.actedBy ? ref(step.actedBy) : null,
          actedAt: step.actedAt?.toISOString() ?? null,
          note: step.note,
        })),
      createdAt: instance.createdAt.toISOString(),
      closedAt: instance.closedAt?.toISOString() ?? null,
    }));
  }
}
