import { Injectable } from '@nestjs/common';
import {
  checkChain,
  type ChainView,
  type PutChainBody,
  type WorkflowStep,
  type WorkflowsResult,
} from '@thelamp/forms';
import {
  AppError,
  type ConfigurationChange,
  type ErrorDetail,
  newId,
  REQUEST_TYPES,
  type RequestType,
} from '@thelamp/shared';
import type { Workflows } from '@thelamp/templates';
import { and, desc, eq } from 'drizzle-orm';
import { workflowDefinitions, workflowSettings } from '../../db/schema/workflow';
import { type AuditActor, AuditLog, SYSTEM_ACTOR, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { DesignationsService } from '../iam/designations.service';
import { People } from '../iam/people';
import { RolesService } from '../iam/roles.service';
import { RequestTypes } from './request-types';

type Definition = typeof workflowDefinitions.$inferSelect;

const invalid = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', issues);

/** The role a tenant without one set falls back to: every tenant has its admins (BR-31). */
const DEFAULT_FALLBACK_ROLE = 'tenant_admin';

/**
 * Each tenant's approval chains (spec 5.9, decision D74): one per request type, kept as versions,
 * so a request records the version that routed it and a change never reroutes requests already
 * waiting. Chains change through the same checks as templates.
 */
@Injectable()
export class ChainsService {
  constructor(
    private readonly people: People,
    private readonly roles: RolesService,
    private readonly designations: DesignationsService,
    private readonly types: RequestTypes,
    private readonly audit: AuditLog,
  ) {}

  /** The chain in force for a request type, if the tenant has one. */
  async current(
    tx: TenantTx,
    tenantId: string,
    type: RequestType,
  ): Promise<Definition | undefined> {
    const [row] = await tx
      .select()
      .from(workflowDefinitions)
      .where(
        and(eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.requestType, type)),
      )
      .orderBy(desc(workflowDefinitions.version))
      .limit(1);
    return row;
  }

  /** A version a request was routed by: its steps' reminders and escalations. */
  async byId(tx: TenantTx, tenantId: string, id: string): Promise<Definition | undefined> {
    const [row] = await tx
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.id, id)));
    return row;
  }

  async fallbackRole(tx: TenantTx, tenantId: string): Promise<string> {
    const [row] = await tx
      .select({ role: workflowSettings.fallbackRole })
      .from(workflowSettings)
      .where(eq(workflowSettings.tenantId, tenantId));
    return row?.role ?? DEFAULT_FALLBACK_ROLE;
  }

  /** Every request type's chain in force, and the fallback role, for the chains screen. */
  async list(tx: TenantTx, tenantId: string): Promise<WorkflowsResult> {
    const latest = await this.latest(tx, tenantId);
    const makers = await this.people.facts(
      tx,
      tenantId,
      [...latest.values()].flatMap((row) => (row.createdBy ? [row.createdBy] : [])),
    );
    const chains: ChainView[] = REQUEST_TYPES.map((requestType) => {
      const row = latest.get(requestType);
      const maker = row?.createdBy ? makers.get(row.createdBy) : undefined;
      return {
        requestType,
        version: row?.version ?? 0,
        steps: row?.steps ?? [],
        updatedAt: row?.createdAt.toISOString() ?? null,
        updatedBy: maker ? { id: maker.id, name: maker.name } : null,
      };
    });
    return { fallbackRole: await this.fallbackRole(tx, tenantId), chains };
  }

  /**
   * A new version of a request type's chain, made on the version the editor showed: someone
   * else's change in between is refused rather than overwritten.
   */
  async setChain(
    tx: TenantTx,
    access: Access,
    type: RequestType,
    body: PutChainBody,
  ): Promise<ChainView> {
    const { tenantId } = access;
    const current = await this.current(tx, tenantId, type);
    if ((current?.version ?? 0) !== body.version) {
      throw new AppError(
        'CONFLICT',
        'Someone changed this chain meanwhile. Reload it and try again.',
      );
    }
    const issues = await this.check(tx, tenantId, type, body.steps, ['steps']);
    if (issues.length > 0) throw invalid(issues);
    const saved = await this.save(tx, tenantId, type, body.steps, userActor(access), current);
    const view = (await this.list(tx, tenantId)).chains.find((chain) => chain.requestType === type);
    return view ?? { ...saved, updatedBy: null };
  }

  async setFallback(tx: TenantTx, access: Access, role: string): Promise<WorkflowsResult> {
    const { tenantId } = access;
    if (!(await this.roleKeys(tx, tenantId)).has(role)) {
      throw invalid([{ path: 'role', issue: `There is no role \`${role}\`` }]);
    }
    const before = await this.fallbackRole(tx, tenantId);
    if (before !== role) {
      await this.saveFallback(tx, tenantId, role, access.userId);
      await this.audit.record(tx, tenantId, userActor(access), {
        action: 'workflow.changed',
        target: { type: 'workflow', id: tenantId },
        before: { fallbackRole: before },
        after: { fallbackRole: role },
      });
    }
    return this.list(tx, tenantId);
  }

  /** A new tenant's chains, from its template (spec 5.14): version 1 of each, made by nobody. */
  async applyTemplate(tx: TenantTx, tenantId: string, workflows: Workflows): Promise<void> {
    await this.saveFallback(tx, tenantId, workflows.fallbackRole, null);
    for (const definition of workflows.definitions) {
      await this.save(
        tx,
        tenantId,
        definition.requestType,
        definition.steps,
        SYSTEM_ACTOR,
        undefined,
      );
    }
  }

  /**
   * The chains as a template holds them (decision D66). A step that names a person stays behind:
   * another tenant has other people, and a template holds none.
   */
  async export(tx: TenantTx, tenantId: string): Promise<Workflows> {
    const latest = await this.latest(tx, tenantId);
    return {
      fallbackRole: await this.fallbackRole(tx, tenantId),
      definitions: REQUEST_TYPES.flatMap((requestType) => {
        const steps = (latest.get(requestType)?.steps ?? []).filter(
          (step) => step.approver.type !== 'specific_user',
        );
        return steps.length > 0 ? [{ requestType, steps }] : [];
      }),
    };
  }

  /**
   * An imported file's chains (decision D66): each that differs becomes a new version, and none
   * is removed. Checked as the chains screen checks them; issues name the file's paths.
   */
  async import(
    tx: TenantTx,
    access: Access,
    workflows: Workflows,
  ): Promise<{ changes: ConfigurationChange[]; issues: ErrorDetail[] }> {
    const { tenantId } = access;
    const changes: ConfigurationChange[] = [];
    const issues: ErrorDetail[] = [];
    const roles = await this.roleKeys(tx, tenantId);
    if (!roles.has(workflows.fallbackRole)) {
      issues.push({
        path: 'workflows.fallbackRole',
        issue: `There is no role \`${workflows.fallbackRole}\``,
      });
    } else if ((await this.fallbackRole(tx, tenantId)) !== workflows.fallbackRole) {
      await this.saveFallback(tx, tenantId, workflows.fallbackRole, access.userId);
      changes.push({ section: 'workflows', key: 'fallbackRole', change: 'update' });
    } else {
      changes.push({ section: 'workflows', key: 'fallbackRole', change: 'same' });
    }
    const latest = await this.latest(tx, tenantId);
    for (const [index, definition] of workflows.definitions.entries()) {
      const current = latest.get(definition.requestType);
      if (current && same(current.steps, definition.steps)) {
        changes.push({ section: 'workflows', key: definition.requestType, change: 'same' });
        continue;
      }
      const found = await this.check(tx, tenantId, definition.requestType, definition.steps, [
        'workflows',
        'definitions',
        index,
        'steps',
      ]);
      if (found.length > 0) {
        issues.push(...found);
        continue;
      }
      await this.save(
        tx,
        tenantId,
        definition.requestType,
        definition.steps,
        userActor(access),
        current,
      );
      changes.push({
        section: 'workflows',
        key: definition.requestType,
        change: current ? 'update' : 'add',
      });
    }
    return { changes, issues };
  }

  private async latest(tx: TenantTx, tenantId: string): Promise<Map<RequestType, Definition>> {
    const rows = await tx
      .selectDistinctOn([workflowDefinitions.requestType])
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.tenantId, tenantId))
      .orderBy(workflowDefinitions.requestType, desc(workflowDefinitions.version));
    return new Map(rows.map((row) => [row.requestType, row]));
  }

  private async save(
    tx: TenantTx,
    tenantId: string,
    type: RequestType,
    steps: WorkflowStep[],
    actor: AuditActor,
    current: Definition | undefined,
  ): Promise<ChainView> {
    const version = (current?.version ?? 0) + 1;
    const createdBy = actor.kind === 'user' ? actor.id : null;
    const [row] = await tx
      .insert(workflowDefinitions)
      .values({ id: newId(), tenantId, requestType: type, version, steps, createdBy })
      .returning();
    await this.audit.record(tx, tenantId, actor, {
      action: 'workflow.changed',
      target: { type: 'workflow', id: row!.id },
      before: current
        ? { requestType: type, version: current.version, steps: current.steps }
        : null,
      after: { requestType: type, version, steps },
    });
    return {
      requestType: type,
      version,
      steps,
      updatedAt: row!.createdAt.toISOString(),
      updatedBy: null,
    };
  }

  private async saveFallback(tx: TenantTx, tenantId: string, role: string, by: string | null) {
    const values = { fallbackRole: role, updatedAt: new Date(), updatedBy: by };
    await tx
      .insert(workflowSettings)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: workflowSettings.tenantId, set: values });
  }

  /** Checks a chain against the tenant's roles, designations, account slots and people. */
  private async check(
    tx: TenantTx,
    tenantId: string,
    type: RequestType,
    steps: readonly WorkflowStep[],
    path: readonly PropertyKey[],
  ): Promise<ErrorDetail[]> {
    const named = steps.flatMap((step) =>
      step.approver.type === 'specific_user' ? [step.approver.userId] : [],
    );
    const people = await this.people.facts(tx, tenantId, named);
    return checkChain(
      type,
      steps,
      {
        roles: await this.roleKeys(tx, tenantId),
        designations: new Set((await this.designations.list(tx, tenantId)).map((d) => d.key)),
        slots: await this.types.slots.keys(tx, tenantId),
        users: new Set([...people.values()].filter((p) => p.status === 'active').map((p) => p.id)),
      },
      path,
    );
  }

  private async roleKeys(tx: TenantTx, tenantId: string): Promise<Set<string>> {
    return new Set((await this.roles.list(tx, tenantId)).map((role) => role.key));
  }
}

/** Whether two chains are the same, whatever order their keys come back in from jsonb. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}
