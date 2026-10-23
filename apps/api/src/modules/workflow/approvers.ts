import { Injectable } from '@nestjs/common';
import { type Approver, conditionHolds, type Values, type WorkflowStep } from '@thelamp/forms';
import type { ResolvedStep } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { RequestTypes } from './request-types';

/** What a request brings to the resolvers: its account, for slot steps, and its facts. */
export interface RequestContext {
  accountId?: string;
  facts?: Values;
}

/**
 * Finds who decides each step of a chain for a request (spec 5.9): the active people a step's
 * resolver names, nearest first. BR-31's routing then decides which steps remain.
 */
@Injectable()
export class Approvers {
  constructor(
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly types: RequestTypes,
  ) {}

  async resolve(
    tx: TenantTx,
    tenantId: string,
    requesterId: string,
    steps: readonly WorkflowStep[],
    context: RequestContext,
  ): Promise<ResolvedStep[]> {
    const ancestors = await this.people.ancestors(tx, tenantId, requesterId);
    const resolved: ResolvedStep[] = [];
    for (const step of steps) {
      resolved.push({
        applies: !step.condition || conditionHolds(step.condition, context.facts ?? {}),
        approvers: await this.approvers(
          tx,
          tenantId,
          requesterId,
          step.approver,
          ancestors,
          context,
        ),
        escalateTo:
          step.escalateIfNoApprover === undefined
            ? undefined
            : await this.role(tx, tenantId, step.escalateIfNoApprover, requesterId),
      });
    }
    return resolved;
  }

  /** The active holders of a role whose scope reaches the requester. */
  role(tx: TenantTx, tenantId: string, role: string, requesterId: string): Promise<string[]> {
    return this.scopes.holdersReaching(tx, tenantId, role, requesterId);
  }

  private async approvers(
    tx: TenantTx,
    tenantId: string,
    requesterId: string,
    approver: Approver,
    ancestors: Awaited<ReturnType<People['ancestors']>>,
    context: RequestContext,
  ): Promise<string[]> {
    switch (approver.type) {
      case 'reporting_manager': {
        const manager = ancestors.find((person) => person.depth === approver.level);
        return manager?.status === 'active' ? [manager.id] : [];
      }
      case 'nearest_designation': {
        const nearest = ancestors.find(
          (person) => person.status === 'active' && person.designation === approver.designation,
        );
        return nearest ? [nearest.id] : [];
      }
      case 'role_in_scope':
        return this.role(tx, tenantId, approver.role, requesterId);
      case 'account_slot': {
        if (!context.accountId) return [];
        const holder = await this.types.slots.holder(
          tx,
          tenantId,
          context.accountId,
          approver.slot,
        );
        return holder ? [holder] : [];
      }
      case 'specific_user': {
        const person = (await this.people.facts(tx, tenantId, [approver.userId])).get(
          approver.userId,
        );
        return person?.status === 'active' ? [person.id] : [];
      }
    }
  }
}
