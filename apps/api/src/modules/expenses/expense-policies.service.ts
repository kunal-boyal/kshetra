import { Injectable } from '@nestjs/common';
import {
  AppError,
  type ExpensePolicy,
  type ExpensePolicyResult,
  expensePolicyIssues,
  issueAt,
  todayIn,
} from '@thelamp/shared';
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { expensePolicies, expensePolicyVersions } from '../../db/schema/expenses';
import { type AuditActor, AuditLog } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { DesignationsService } from '../iam/designations.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/** The first versions, from a template or an older tenant, are in force for any day. */
const BEGINNING = '2000-01-01';

/** A value as JSON with object keys sorted, as jsonb keeps them in its own order. */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, part: unknown) =>
    part && typeof part === 'object' && !Array.isArray(part)
      ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => (a < b ? -1 : 1)))
      : part,
  );

/** A policy's terms, without the version and day it took effect. */
export function termsOf(policy: ExpensePolicyResult): ExpensePolicy {
  return {
    key: policy.key,
    name: policy.name,
    category: policy.category,
    calculation: policy.calculation,
    ...(policy.rate ? { rate: policy.rate } : {}),
    caps: policy.caps,
    receiptRequired: policy.receiptRequired,
    odometerPhotosRequired: policy.odometerPhotosRequired,
    active: policy.active,
  };
}

/** Whether two policies pay the same; switching one on or off is not a new version. */
const same = (a: ExpensePolicy, b: ExpensePolicy) =>
  canonical({ ...a, active: undefined }) === canonical({ ...b, active: undefined });

/**
 * Expense policies (M12, spec 5.10, decision D83): each tenant's policies as configuration lists
 * them, keyed and never removed, since claims name them. A change to how a policy pays is a new
 * version from a day, today unless told otherwise; claims keep the version in force on their day. A
 * new policy has no earlier terms, so it takes claims for any day. Switching one off is not a
 * version: it stops new claims at once.
 */
@Injectable()
export class ExpensePoliciesService {
  constructor(
    private readonly designations: DesignationsService,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  async applyTemplate(
    tx: TenantTx,
    tenantId: string,
    policies: readonly ExpensePolicy[] | undefined,
  ): Promise<void> {
    if (!policies || policies.length === 0) return;
    await tx
      .insert(expensePolicies)
      .values(
        policies.map((policy, position) => ({
          tenantId,
          key: policy.key,
          currentVersion: 1,
          active: policy.active,
          position,
        })),
      )
      .onConflictDoNothing();
    await tx
      .insert(expensePolicyVersions)
      .values(
        policies.map((policy) => ({
          tenantId,
          policyKey: policy.key,
          version: 1,
          definition: policy,
          validFrom: BEGINNING,
        })),
      )
      .onConflictDoNothing();
  }

  /** Every policy as it stands now, in order. */
  async list(tx: TenantTx, tenantId: string): Promise<ExpensePolicyResult[]> {
    const rows = await tx
      .select({
        key: expensePolicies.key,
        active: expensePolicies.active,
        version: expensePolicyVersions.version,
        definition: expensePolicyVersions.definition,
        validFrom: expensePolicyVersions.validFrom,
      })
      .from(expensePolicies)
      .innerJoin(
        expensePolicyVersions,
        and(
          eq(expensePolicyVersions.tenantId, expensePolicies.tenantId),
          eq(expensePolicyVersions.policyKey, expensePolicies.key),
          eq(expensePolicyVersions.version, expensePolicies.currentVersion),
        ),
      )
      .where(eq(expensePolicies.tenantId, tenantId))
      .orderBy(asc(expensePolicies.position), asc(expensePolicies.key));
    return rows.map((row) => ({
      ...row.definition,
      active: row.active,
      version: row.version,
      validFrom: row.validFrom,
    }));
  }

  /**
   * The version of a policy in force on a day, and whether the policy takes claims now; null when
   * there is no such policy or no version yet.
   */
  async on(
    tx: TenantTx,
    tenantId: string,
    key: string,
    day: string,
  ): Promise<{ policy: ExpensePolicy; version: number } | null> {
    const [row] = await tx
      .select({
        active: expensePolicies.active,
        version: expensePolicyVersions.version,
        definition: expensePolicyVersions.definition,
      })
      .from(expensePolicies)
      .innerJoin(
        expensePolicyVersions,
        and(
          eq(expensePolicyVersions.tenantId, expensePolicies.tenantId),
          eq(expensePolicyVersions.policyKey, expensePolicies.key),
        ),
      )
      .where(
        and(
          eq(expensePolicies.tenantId, tenantId),
          eq(expensePolicies.key, key),
          lte(expensePolicyVersions.validFrom, day),
        ),
      )
      .orderBy(desc(expensePolicyVersions.validFrom), desc(expensePolicyVersions.version))
      .limit(1);
    return row ? { policy: { ...row.definition, active: row.active }, version: row.version } : null;
  }

  /** A version of a policy, as a claim recorded it. */
  async version(
    tx: TenantTx,
    tenantId: string,
    key: string,
    version: number,
  ): Promise<ExpensePolicy | null> {
    const [row] = await tx
      .select({ definition: expensePolicyVersions.definition })
      .from(expensePolicyVersions)
      .where(
        and(
          eq(expensePolicyVersions.tenantId, tenantId),
          eq(expensePolicyVersions.policyKey, key),
          eq(expensePolicyVersions.version, version),
        ),
      );
    return row?.definition ?? null;
  }

  /**
   * `PUT /v1/expense-policies`: the whole list, in order. Every policy kept must stay in it; a
   * policy whose terms changed gets a version from `from`. Says whether anything changed.
   */
  async replace(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    policies: readonly ExpensePolicy[],
    from?: string,
  ): Promise<'same' | 'update'> {
    const before = await this.list(tx, tenantId);
    const sent = new Set(policies.map((policy) => policy.key));
    const designations = new Set(
      (await this.designations.list(tx, tenantId)).map((designation) => designation.key),
    );
    const { timezone } = await this.config.settings(tx, tenantId);
    const today = todayIn(timezone);
    const starts = from ?? today;
    const issues = [
      ...policies.flatMap((policy, index) => [
        ...(policies.findIndex((other) => other.key === policy.key) !== index
          ? [issueAt(['items', index, 'key'], 'This key is in the list already')]
          : []),
        ...expensePolicyIssues(policy, designations, ['items', index]),
      ]),
      ...before.flatMap((policy) =>
        sent.has(policy.key)
          ? []
          : [issueAt(['items'], `Keep ${policy.key}; switch it off instead of removing it`)],
      ),
      ...before.flatMap((policy) =>
        sent.has(policy.key) && starts < policy.validFrom
          ? [
              issueAt(
                ['from'],
                `Start on or after ${policy.validFrom}, when ${policy.key} last changed`,
              ),
            ]
          : [],
      ),
    ];
    if (issues.length > 0) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', issues);
    }
    let changed = false;
    for (const [position, policy] of policies.entries()) {
      const was = before.find((entry) => entry.key === policy.key);
      if (!was) {
        changed = true;
        await tx.insert(expensePolicies).values({
          tenantId,
          key: policy.key,
          currentVersion: 1,
          active: policy.active,
          position,
        });
        // A new policy has no earlier terms to keep: it takes claims for any day.
        await tx.insert(expensePolicyVersions).values({
          tenantId,
          policyKey: policy.key,
          version: 1,
          definition: policy,
          validFrom: BEGINNING,
        });
        continue;
      }
      const { version } = was;
      const moved = !same(termsOf(was), policy);
      if (!moved && was.active === policy.active && before.indexOf(was) === position) continue;
      changed = true;
      if (moved) {
        if (starts === was.validFrom) {
          // Changed again the same day: the day's version is corrected, not stacked.
          await tx
            .update(expensePolicyVersions)
            .set({ definition: policy })
            .where(
              and(
                eq(expensePolicyVersions.tenantId, tenantId),
                eq(expensePolicyVersions.policyKey, policy.key),
                eq(expensePolicyVersions.version, version),
              ),
            );
        } else {
          await tx.insert(expensePolicyVersions).values({
            tenantId,
            policyKey: policy.key,
            version: version + 1,
            definition: policy,
            validFrom: starts,
          });
        }
      }
      await tx
        .update(expensePolicies)
        .set({
          active: policy.active,
          position,
          currentVersion: moved && starts !== was.validFrom ? version + 1 : version,
          updatedAt: new Date(),
        })
        .where(and(eq(expensePolicies.tenantId, tenantId), eq(expensePolicies.key, policy.key)));
    }
    if (!changed) return 'same';
    await this.config.touch(tx, tenantId, actor.kind === 'user' ? actor.id : null);
    await this.audit.record(tx, tenantId, actor, {
      action: 'expense_policies.changed',
      target: { type: 'expense_policies', id: null },
      before: { items: before },
      after: { items: policies, from: starts },
    });
    return 'update';
  }
}
