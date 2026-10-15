import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CopyTargetsBody,
  type CopyTargetsResult,
  type ErrorDetail,
  issueAt,
  type LockTargetsBody,
  type LockTargetsResult,
  type MetricView,
  newId,
  type PutTargetsBody,
  type PutTargetsResult,
  targetValueIssue,
  type TargetListResult,
  type TargetSetResult,
  type TargetValues,
  type UnlockTargetBody,
  unlockRefusal,
  UNLOCK_REASON_MIN,
} from '@kshetra/shared';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { users } from '../../db/schema/iam';
import { targetLines, targetSets } from '../../db/schema/planning';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { MetricsService } from '../metrics/metrics.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

type SetRow = typeof targetSets.$inferSelect;
type Skip = LockTargetsResult['skipped'][number]['reason'];

/** A stored value as text, without the trailing zeros of `numeric(18,3)`. */
const tidy = (value: string) => value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

/**
 * Targets (spec 5.8, BR-08): one set per person per month, holding a value for each targetable
 * metric. Managers draft them for the people in their scope, never their own, copy them from an
 * earlier month or import them, and lock them. A locked set changes only through an admin unlock
 * with a reason, where the tenant allows it. Every edit carries the version it was made on.
 */
@Injectable()
export class TargetsService {
  constructor(
    private readonly audit: AuditLog,
    private readonly scopes: Scopes,
    private readonly people: People,
    private readonly metrics: MetricsService,
    private readonly settings: TenantConfigService,
    private readonly outbox: Outbox,
  ) {}

  private async sets(
    tx: TenantTx,
    tenantId: string,
    period: string,
    userIds: readonly string[],
  ): Promise<Map<string, TargetSetResult>> {
    const found = new Map<string, TargetSetResult>();
    if (userIds.length === 0) return found;
    const people = await this.people.facts(tx, tenantId, [...userIds]);
    const rows = await tx
      .select()
      .from(targetSets)
      .where(
        and(
          eq(targetSets.tenantId, tenantId),
          eq(targetSets.period, period),
          inArray(targetSets.userId, [...userIds]),
        ),
      );
    const lines = rows.length
      ? await tx
          .select()
          .from(targetLines)
          .where(
            and(
              eq(targetLines.tenantId, tenantId),
              inArray(
                targetLines.targetSetId,
                rows.map((row) => row.id),
              ),
            ),
          )
      : [];
    const lockers = await this.people.facts(
      tx,
      tenantId,
      rows.flatMap((row) => (row.lockedBy ? [row.lockedBy] : [])),
    );
    for (const userId of userIds) {
      const person = people.get(userId);
      const row = rows.find((entry) => entry.userId === userId);
      found.set(userId, {
        user: { id: userId, code: person?.code ?? '', name: person?.name ?? '' },
        period,
        status: row?.status ?? 'none',
        values: Object.fromEntries(
          lines
            .filter((line) => line.targetSetId === row?.id)
            .map((line) => [line.metricKey, tidy(line.value)]),
        ),
        lockedAt: row?.lockedAt?.toISOString() ?? null,
        lockedBy: row?.lockedBy
          ? { id: row.lockedBy, name: lockers.get(row.lockedBy)?.name ?? '' }
          : null,
        version: row?.version ?? 0,
      });
    }
    return found;
  }

  /**
   * The month's targets of the people in the caller's scope, the caller apart, by name; the
   * caller's own; and each metric summed over the people, for the team view against the
   * manager's own target (spec 5.8).
   */
  async list(tx: TenantTx, access: Access, period: string): Promise<TargetListResult> {
    const tenantId = access.tenantId;
    const metrics = await this.metrics.targetable(tx, tenantId);
    const team = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.status, 'active'),
          ne(users.id, access.userId),
          await this.scopes.users(tx, access),
        ),
      )
      .orderBy(asc(users.name), asc(users.id));
    const ids = team.map((row) => row.id);
    const sets = await this.sets(tx, tenantId, period, [...ids, access.userId]);
    const totals = ids.length
      ? await tx
          .select({
            key: targetLines.metricKey,
            total: sql<string>`sum(${targetLines.value})::text`,
          })
          .from(targetLines)
          .innerJoin(
            targetSets,
            and(
              eq(targetSets.tenantId, targetLines.tenantId),
              eq(targetSets.id, targetLines.targetSetId),
            ),
          )
          .where(
            and(
              eq(targetLines.tenantId, tenantId),
              eq(targetSets.period, period),
              inArray(targetSets.userId, ids),
            ),
          )
          .groupBy(targetLines.metricKey)
      : [];
    return {
      period,
      metrics,
      sets: ids.map((id) => sets.get(id)!),
      own: sets.get(access.userId)!,
      totals: Object.fromEntries(totals.map((row) => [row.key, tidy(row.total)])),
    };
  }

  /** Problems with values for targetable metrics, by path under `prefix`. */
  static valueIssues(
    metrics: readonly MetricView[],
    values: TargetValues,
    prefix: (string | number)[],
  ): ErrorDetail[] {
    const units = new Map(metrics.map((metric) => [metric.key, metric.unit]));
    const issues: ErrorDetail[] = [];
    for (const [key, value] of Object.entries(values)) {
      const unit = units.get(key);
      if (!unit) issues.push(issueAt([...prefix, key], 'This metric has no targets'));
      else if (value !== null) {
        const issue = targetValueIssue(unit, value);
        if (issue) issues.push(issueAt([...prefix, key], issue));
      }
    }
    return issues;
  }

  /** Why the caller can't set this person's targets, or null when they can. */
  async refusal(tx: TenantTx, access: Access, userId: string): Promise<Skip | null> {
    if (userId === access.userId) return 'OWN';
    if (!(await this.scopes.reaches(tx, access, userId))) return 'OUT_OF_SCOPE';
    return null;
  }

  /** A person's set for the month, locked for the change that reads it unless `lock` is false. */
  async row(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    period: string,
    lock = true,
  ): Promise<SetRow | undefined> {
    const query = tx
      .select()
      .from(targetSets)
      .where(
        and(
          eq(targetSets.tenantId, tenantId),
          eq(targetSets.userId, userId),
          eq(targetSets.period, period),
        ),
      );
    const [row] = lock ? await query.for('update') : await query;
    return row;
  }

  /**
   * Writes values into a person's set for the month, making the set if there is none; `null`
   * clears a value and a metric left out stays as it was. The caller has checked everything.
   */
  async write(
    tx: TenantTx,
    access: Access,
    userId: string,
    period: string,
    values: TargetValues,
    row: SetRow | undefined,
  ): Promise<void> {
    const tenantId = access.tenantId;
    const setId = row?.id ?? newId();
    if (row) {
      await tx
        .update(targetSets)
        .set({ version: row.version + 1, updatedAt: new Date(), updatedBy: access.userId })
        .where(and(eq(targetSets.tenantId, tenantId), eq(targetSets.id, setId)));
    } else {
      await tx.insert(targetSets).values({
        id: setId,
        tenantId,
        userId,
        period,
        updatedBy: access.userId,
      });
    }
    for (const [metricKey, value] of Object.entries(values)) {
      if (value === null) {
        await tx
          .delete(targetLines)
          .where(
            and(
              eq(targetLines.tenantId, tenantId),
              eq(targetLines.targetSetId, setId),
              eq(targetLines.metricKey, metricKey),
            ),
          );
      } else {
        await tx
          .insert(targetLines)
          .values({ tenantId, targetSetId: setId, metricKey, value: value.trim() })
          .onConflictDoUpdate({
            target: [targetLines.tenantId, targetLines.targetSetId, targetLines.metricKey],
            set: { value: value.trim() },
          });
      }
    }
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'target.updated',
      target: { type: 'user', id: userId },
      before: row ? { version: row.version } : null,
      after: { period, values },
    });
  }

  /**
   * Drafts values for some people (spec 5.8): each in the caller's scope, never the caller;
   * each set still a draft (`TARGET_LOCKED`) and at the version the editor saw (`CONFLICT`).
   * Every set is checked before any is written.
   */
  async put(tx: TenantTx, access: Access, body: PutTargetsBody): Promise<PutTargetsResult> {
    const tenantId = access.tenantId;
    const metrics = await this.metrics.targetable(tx, tenantId);
    const issues = body.sets.flatMap((set, index) =>
      TargetsService.valueIssues(metrics, set.values, ['sets', index, 'values']),
    );
    if (issues.length > 0) {
      throw new AppError('VALIDATION', 'Check the highlighted values.', issues);
    }
    const rows: (SetRow | undefined)[] = [];
    for (const set of body.sets) {
      const refusal = await this.refusal(tx, access, set.userId);
      if (refusal === 'OWN') {
        throw new AppError('FORBIDDEN', 'Your own targets are set by your manager.');
      }
      if (refusal) throw outOfScope();
      const row = await this.row(tx, tenantId, set.userId, body.period);
      if (row?.status === 'locked') {
        throw new AppError('TARGET_LOCKED', 'These targets are locked.');
      }
      if ((row?.version ?? 0) !== set.version) {
        throw new AppError('CONFLICT', 'Someone changed these targets meanwhile. Reload them.');
      }
      rows.push(row);
    }
    for (const [index, set] of body.sets.entries()) {
      await this.write(tx, access, set.userId, body.period, set.values, rows[index]);
    }
    const sets = await this.sets(
      tx,
      tenantId,
      body.period,
      body.sets.map((set) => set.userId),
    );
    return { sets: body.sets.map((set) => sets.get(set.userId)!) };
  }

  /**
   * Locks drafts (BR-08). Only a draft with values locks; a set locked already, perhaps by
   * someone at the same moment, is `TARGET_LOCKED`, as the first lock wins.
   */
  async lock(tx: TenantTx, access: Access, body: LockTargetsBody): Promise<LockTargetsResult> {
    const tenantId = access.tenantId;
    const locked: string[] = [];
    const skipped: LockTargetsResult['skipped'] = [];
    for (const userId of [...new Set(body.userIds)]) {
      const refusal = await this.refusal(tx, access, userId);
      if (refusal) {
        skipped.push({ userId, reason: refusal });
        continue;
      }
      const row = await this.row(tx, tenantId, userId, body.period);
      if (row?.status === 'locked') {
        skipped.push({ userId, reason: 'TARGET_LOCKED' });
        continue;
      }
      const [held] = row
        ? await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(targetLines)
            .where(and(eq(targetLines.tenantId, tenantId), eq(targetLines.targetSetId, row.id)))
        : [{ count: 0 }];
      if (!row || !held?.count) {
        skipped.push({ userId, reason: 'EMPTY' });
        continue;
      }
      const [done] = await tx
        .update(targetSets)
        .set({
          status: 'locked',
          lockedAt: new Date(),
          lockedBy: access.userId,
          version: row.version + 1,
          updatedAt: new Date(),
          updatedBy: access.userId,
        })
        .where(
          and(
            eq(targetSets.tenantId, tenantId),
            eq(targetSets.id, row.id),
            eq(targetSets.status, 'draft'),
          ),
        )
        .returning({ id: targetSets.id });
      if (!done) {
        skipped.push({ userId, reason: 'TARGET_LOCKED' });
        continue;
      }
      await this.audit.record(tx, tenantId, userActor(access), {
        action: 'target.locked',
        target: { type: 'user', id: userId },
        before: { period: body.period, status: 'draft' },
        after: { period: body.period, status: 'locked' },
      });
      await this.outbox.publish(tx, tenantId, 'target.locked', row.id, {
        targetSetId: row.id,
        userId,
        period: body.period,
      });
      locked.push(userId);
    }
    return { locked, skipped };
  }

  /** Back to draft (BR-08): admin unlock switched on, the permission, and a reason. */
  async unlock(tx: TenantTx, access: Access, body: UnlockTargetBody): Promise<TargetSetResult> {
    const tenantId = access.tenantId;
    const { targetUnlockByAdmin } = await this.settings.settings(tx, tenantId);
    const refusal = unlockRefusal({
      adminUnlock: targetUnlockByAdmin,
      holdsUnlock: access.permissions.has('target.unlock'),
      reason: body.reason,
    });
    if (refusal === 'NOT_ENABLED') {
      throw new AppError('TARGET_LOCKED', 'Locked targets can’t be unlocked here.');
    }
    if (refusal === 'FORBIDDEN') throw new AppError('FORBIDDEN', 'You can’t unlock targets.');
    if (refusal === 'REASON_REQUIRED') {
      throw new AppError('VALIDATION', 'Say why.', [
        { path: 'reason', issue: `Write at least ${UNLOCK_REASON_MIN} characters` },
      ]);
    }
    if ((await this.refusal(tx, access, body.userId)) === 'OUT_OF_SCOPE') throw outOfScope();
    const row = await this.row(tx, tenantId, body.userId, body.period);
    if (row?.status !== 'locked') {
      throw new AppError('CONFLICT', 'These targets aren’t locked.');
    }
    await tx
      .update(targetSets)
      .set({
        status: 'draft',
        lockedAt: null,
        lockedBy: null,
        version: row.version + 1,
        updatedAt: new Date(),
        updatedBy: access.userId,
      })
      .where(and(eq(targetSets.tenantId, tenantId), eq(targetSets.id, row.id)));
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'target.unlocked',
      target: { type: 'user', id: body.userId },
      before: { period: body.period, status: 'locked' },
      after: { period: body.period, status: 'draft', reason: body.reason.trim() },
    });
    await this.outbox.publish(tx, tenantId, 'target.unlocked', row.id, {
      targetSetId: row.id,
      userId: body.userId,
      period: body.period,
    });
    return (await this.sets(tx, tenantId, body.period, [body.userId])).get(body.userId)!;
  }

  /** Copies an earlier month's values into these people's drafts (spec 5.8). */
  async copy(tx: TenantTx, access: Access, body: CopyTargetsBody): Promise<CopyTargetsResult> {
    const tenantId = access.tenantId;
    if (body.from === body.period) {
      throw new AppError('VALIDATION', 'Copy from another month.', [
        { path: 'from', issue: 'Choose an earlier month' },
      ]);
    }
    const keys = new Set((await this.metrics.targetable(tx, tenantId)).map((metric) => metric.key));
    const copied: string[] = [];
    const skipped: CopyTargetsResult['skipped'] = [];
    for (const userId of [...new Set(body.userIds)]) {
      const refusal = await this.refusal(tx, access, userId);
      if (refusal) {
        skipped.push({ userId, reason: refusal });
        continue;
      }
      const source = (await this.sets(tx, tenantId, body.from, [userId])).get(userId)!;
      const values = Object.fromEntries(
        Object.entries(source.values).filter(([key]) => keys.has(key)),
      );
      if (Object.keys(values).length === 0) {
        skipped.push({ userId, reason: 'NOTHING_TO_COPY' });
        continue;
      }
      const row = await this.row(tx, tenantId, userId, body.period);
      if (row?.status === 'locked') {
        skipped.push({ userId, reason: 'TARGET_LOCKED' });
        continue;
      }
      await this.write(tx, access, userId, body.period, values, row);
      copied.push(userId);
    }
    return { copied, skipped };
  }
}
