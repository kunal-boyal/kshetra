import { Injectable } from '@nestjs/common';
import type { WorkflowStep } from '@thelamp/forms';
import {
  AppError,
  type ApprovalDecisionBody,
  type ApprovalInboxQuery,
  type ApprovalInboxResult,
  type ApprovalResult,
  newId,
  nextStep,
  type RequestType,
  type RoutedStep,
  routeRequest,
} from '@thelamp/shared';
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { workflowInstances, workflowSteps } from '../../db/schema/workflow';
import { type AuditActor, AuditLog, SYSTEM_ACTOR, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Approvers, type RequestContext } from './approvers';
import { ChainsService } from './chains.service';
import { RequestTypes } from './request-types';

type Instance = typeof workflowInstances.$inferSelect;
type Step = typeof workflowSteps.$inferSelect;

const HOUR_MS = 3_600_000;

/**
 * Approvals (spec 5.9, M15, BR-31, decision D74). A request type with a chain is routed through
 * it: each step's approvers are resolved when the request starts, steps nobody can or should
 * decide are skipped, and the request waits at one step at a time. A type without a chain goes to
 * the requester's manager for one decision, as in phase 1 (decision D38).
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly people: People,
    private readonly types: RequestTypes,
    private readonly chains: ChainsService,
    private readonly approvers: Approvers,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
  ) {}

  /**
   * Starts the approval of a request, in the transaction that makes it. `context` brings the
   * request's account, for slot steps, and its facts, for step conditions. Refused when nobody
   * could ever decide it. Returns the instance's ID.
   */
  async request(
    tx: TenantTx,
    tenantId: string,
    requesterId: string,
    type: RequestType,
    requestId: string,
    actor: AuditActor,
    context: RequestContext = {},
  ): Promise<string> {
    const requester = (await this.people.facts(tx, tenantId, [requesterId])).get(requesterId);
    if (!requester) throw notFound();
    const chain = await this.chains.current(tx, tenantId, type);
    const routed = chain
      ? routeRequest(
          await this.approvers.resolve(tx, tenantId, requesterId, chain.steps, context),
          requesterId,
          await this.approvers.role(
            tx,
            tenantId,
            await this.chains.fallbackRole(tx, tenantId),
            requesterId,
          ),
        )
      : await this.managerOnly(tx, tenantId, requester.managerId, requesterId, type);
    if (!routed) {
      throw new AppError('CONFLICT', 'Nobody can approve this yet. Ask an admin to set a manager.');
    }
    const id = newId();
    const current = routed.findIndex((step) => step.status === 'pending');
    const now = new Date();
    await tx.insert(workflowInstances).values({
      id,
      tenantId,
      definitionId: chain?.id ?? null,
      requestType: type,
      requestId,
      requesterId,
      currentStep: current,
    });
    await tx.insert(workflowSteps).values(
      routed.map((step, index) => ({
        tenantId,
        instanceId: id,
        stepIndex: index,
        approverIds: step.approvers,
        status: step.status,
        skipReason: step.skipReason,
        escalated: step.escalated,
        fallback: step.fallback,
        lineDecisions: chain?.steps[index]?.lineDecisions ?? false,
        ...(index === current ? this.timing(chain?.steps[index], now) : {}),
      })),
    );
    const approvers = routed[current]!.approvers;
    await this.audit.record(tx, tenantId, actor, {
      action: 'approval.requested',
      target: { type: 'approval', id },
      after: { requestType: type, requestId, approvers, chainVersion: chain?.version ?? null },
    });
    await this.outbox.publish(tx, tenantId, 'approval.requested', id, {
      approvalId: id,
      requestType: type,
      requesterId,
      approverIds: approvers,
    });
    return id;
  }

  /**
   * Phase 1's route, for a type without a chain (decision D38): the requester's active manager,
   * or whoever may decide across the tenant.
   */
  private async managerOnly(
    tx: TenantTx,
    tenantId: string,
    managerId: string | null,
    requesterId: string,
    type: RequestType,
  ): Promise<RoutedStep[] | null> {
    const manager = managerId
      ? (await this.people.facts(tx, tenantId, [managerId])).get(managerId)
      : undefined;
    const approvers =
      manager && manager.status === 'active' && manager.id !== requesterId
        ? [manager.id]
        : await this.people.holding(
            tx,
            tenantId,
            this.types.get(type).fallbackPermission,
            requesterId,
          );
    if (approvers.length === 0) return null;
    return [{ approvers, status: 'pending', skipReason: null, escalated: false, fallback: false }];
  }

  /** When a step that starts waiting now should remind, and escalate. */
  private timing(step: WorkflowStep | undefined, now: Date) {
    const at = (hours: number | undefined) =>
      hours === undefined ? null : new Date(now.getTime() + hours * HOUR_MS);
    return {
      startedAt: now,
      remindAt: at(step?.reminderAfterHours),
      escalateAt: at(step?.escalation?.afterHours),
      escalateTo: step?.escalation?.to ?? null,
    };
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

  /** How many requests wait for the caller's decision, for the home dashboard (M18). */
  async waitingCount(tx: TenantTx, access: Access): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowInstances)
      .innerJoin(workflowSteps, this.currentStepOf())
      .where(this.waitingFor(access));
    return row?.count ?? 0;
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
      .innerJoin(workflowSteps, this.currentStepOf())
      .where(
        and(
          this.waitingFor(access),
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

  private currentStepOf() {
    return and(
      eq(workflowSteps.tenantId, workflowInstances.tenantId),
      eq(workflowSteps.instanceId, workflowInstances.id),
      eq(workflowSteps.stepIndex, workflowInstances.currentStep),
    );
  }

  private waitingFor(access: Access) {
    return and(
      eq(workflowInstances.tenantId, access.tenantId),
      eq(workflowInstances.status, 'pending'),
      eq(workflowSteps.status, 'pending'),
      sql`${access.userId}::uuid = any(${workflowSteps.approverIds})`,
    );
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
   * one decision is saved and the other gets 409. An approval moves the request to its next
   * remaining step; the last approval, or any rejection, ends it.
   */
  async decide(
    tx: TenantTx,
    access: Access,
    id: string,
    body: ApprovalDecisionBody,
  ): Promise<ApprovalResult> {
    const { tenantId } = access;
    const instance = await this.find(tx, tenantId, id, true);
    if (instance.requesterId === access.userId) {
      throw new AppError('FORBIDDEN', 'Nobody decides their own request.');
    }
    const steps = await this.steps(tx, tenantId, [id]);
    const step = steps.find((entry) => entry.stepIndex === instance.currentStep);
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
      .where(this.stepKey(tenantId, id, step.stepIndex));
    const next = outcome === 'approved' ? nextStep(steps, step.stepIndex) : null;
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'approval.decided',
      target: { type: 'approval', id },
      before: { status: instance.status, step: step.stepIndex },
      after: {
        status: next === null ? outcome : 'pending',
        step: next ?? step.stepIndex,
        note: body.note ?? null,
      },
    });
    let saved: Instance;
    if (next !== null) {
      const definition = instance.definitionId
        ? await this.chains.byId(tx, tenantId, instance.definitionId)
        : undefined;
      await tx
        .update(workflowSteps)
        .set({ status: 'pending', ...this.timing(definition?.steps[next], now) })
        .where(this.stepKey(tenantId, id, next));
      [saved] = (await tx
        .update(workflowInstances)
        .set({ currentStep: next, version: instance.version + 1 })
        .where(and(eq(workflowInstances.tenantId, tenantId), eq(workflowInstances.id, id)))
        .returning()) as [Instance];
      await this.outbox.publish(tx, tenantId, 'approval.waiting', id, {
        approvalId: id,
        requestType: instance.requestType,
        requesterId: instance.requesterId,
        approverIds: steps.find((entry) => entry.stepIndex === next)!.approverIds,
        stepIndex: next,
        reason: 'next_step',
      });
    } else {
      [saved] = (await tx
        .update(workflowInstances)
        .set({ status: outcome, version: instance.version + 1, closedAt: now })
        .where(and(eq(workflowInstances.tenantId, tenantId), eq(workflowInstances.id, id)))
        .returning()) as [Instance];
      await this.types.get(instance.requestType).decided(tx, access, instance.requestId, outcome);
      await this.outbox.publish(tx, tenantId, 'approval.decided', id, {
        approvalId: id,
        requestType: instance.requestType,
        requesterId: instance.requesterId,
        deciderId: access.userId,
        outcome,
      });
    }
    const [result] = await this.results(tx, tenantId, [saved]);
    return result!;
  }

  /**
   * The requester withdraws a request nobody has decided any step of yet (M15). Its record
   * ends as a rejected one would.
   */
  async cancel(tx: TenantTx, access: Access, id: string): Promise<ApprovalResult> {
    const { tenantId } = access;
    const instance = await this.find(tx, tenantId, id, true);
    if (instance.requesterId !== access.userId) {
      const steps = await this.steps(tx, tenantId, [id]);
      if (steps.some((step) => step.approverIds.includes(access.userId))) {
        throw new AppError('FORBIDDEN', 'Only the person who asked can withdraw a request.');
      }
      throw outOfScope();
    }
    const steps = await this.steps(tx, tenantId, [id]);
    if (instance.status !== 'pending' || steps.some((step) => step.actedBy !== null)) {
      throw new AppError('CONFLICT', 'Someone has decided this already, so it can’t be withdrawn.');
    }
    const now = new Date();
    const [saved] = (await tx
      .update(workflowInstances)
      .set({ status: 'cancelled', version: instance.version + 1, closedAt: now })
      .where(and(eq(workflowInstances.tenantId, tenantId), eq(workflowInstances.id, id)))
      .returning()) as [Instance];
    await this.types.get(instance.requestType).decided(tx, access, instance.requestId, 'cancelled');
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'approval.cancelled',
      target: { type: 'approval', id },
      before: { status: instance.status },
      after: { status: 'cancelled' },
    });
    const [result] = await this.results(tx, tenantId, [saved]);
    return result!;
  }

  /**
   * Reminds the approvers of steps that waited past their reminder time, and escalates steps
   * that waited past their escalation time to the holders of the escalation role whose scope
   * reaches the requester (spec 5.9). Each happens once per step; idempotent.
   */
  async keepTime(tx: TenantTx, tenantId: string, now = new Date()): Promise<number> {
    const due = await tx
      .select({ instance: workflowInstances, step: workflowSteps })
      .from(workflowInstances)
      .innerJoin(workflowSteps, this.currentStepOf())
      .where(
        and(
          eq(workflowInstances.tenantId, tenantId),
          eq(workflowInstances.status, 'pending'),
          eq(workflowSteps.status, 'pending'),
          or(
            and(lte(workflowSteps.remindAt, now), isNull(workflowSteps.remindedAt)),
            and(lte(workflowSteps.escalateAt, now), isNull(workflowSteps.escalatedAt)),
          ),
        ),
      )
      .for('update', { skipLocked: true });
    for (const { instance, step } of due) {
      const key = this.stepKey(tenantId, instance.id, step.stepIndex);
      if (step.escalateAt && step.escalateAt <= now && !step.escalatedAt) {
        const added = step.escalateTo
          ? (await this.approvers.role(tx, tenantId, step.escalateTo, instance.requesterId)).filter(
              (id) => id !== instance.requesterId && !step.approverIds.includes(id),
            )
          : [];
        await tx
          .update(workflowSteps)
          .set({
            approverIds: [...step.approverIds, ...added],
            escalated: step.escalated || added.length > 0,
            escalatedAt: now,
            // Escalating is the stronger nudge, so no reminder follows it.
            remindedAt: step.remindedAt ?? now,
          })
          .where(key);
        if (added.length > 0) {
          await this.audit.record(tx, tenantId, SYSTEM_ACTOR, {
            action: 'approval.escalated',
            target: { type: 'approval', id: instance.id },
            before: { approvers: step.approverIds },
            after: { approvers: [...step.approverIds, ...added], role: step.escalateTo },
          });
          await this.outbox.publish(tx, tenantId, 'approval.waiting', instance.id, {
            approvalId: instance.id,
            requestType: instance.requestType,
            requesterId: instance.requesterId,
            approverIds: added,
            stepIndex: step.stepIndex,
            reason: 'escalated',
          });
        }
        continue;
      }
      await tx.update(workflowSteps).set({ remindedAt: now }).where(key);
      await this.outbox.publish(tx, tenantId, 'approval.waiting', instance.id, {
        approvalId: instance.id,
        requestType: instance.requestType,
        requesterId: instance.requesterId,
        approverIds: step.approverIds,
        stepIndex: step.stepIndex,
        reason: 'reminder',
      });
    }
    return due.length;
  }

  private stepKey(tenantId: string, instanceId: string, index: number) {
    return and(
      eq(workflowSteps.tenantId, tenantId),
      eq(workflowSteps.instanceId, instanceId),
      eq(workflowSteps.stepIndex, index),
    );
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
    return instances.map((instance) => {
      const own = steps.filter((step) => step.instanceId === instance.id);
      return {
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
        steps: own.map((step) => ({
          index: step.stepIndex,
          approvers: step.approverIds.map(ref),
          status: step.status,
          actedBy: step.actedBy ? ref(step.actedBy) : null,
          actedAt: step.actedAt?.toISOString() ?? null,
          note: step.note,
          skipReason: step.skipReason,
          escalated: step.escalated,
          fallback: step.fallback,
        })),
        cancellable: instance.status === 'pending' && own.every((step) => step.actedBy === null),
        createdAt: instance.createdAt.toISOString(),
        closedAt: instance.closedAt?.toISOString() ?? null,
      };
    });
  }
}
