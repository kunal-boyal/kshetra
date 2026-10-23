import { Injectable } from '@nestjs/common';
import {
  type AccountPlanResult,
  AppError,
  type PutAccountPlanBody,
  type TargetValues,
} from '@thelamp/shared';
import { and, desc, eq } from 'drizzle-orm';
import { accountPlans } from '../../db/schema/planning';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { People } from '../iam/people';
import { MetricsService } from '../metrics/metrics.service';
import { TargetsService } from './targets.service';

const tidy = (value: string) => value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

/**
 * Account plans (M8): planned values per account per targetable metric for a month, entered or
 * imported by managers, seen by everyone who sees the account. A reference for the team; they
 * never change anyone's targets.
 */
@Injectable()
export class AccountPlansService {
  constructor(
    private readonly audit: AuditLog,
    private readonly accounts: AccountsService,
    private readonly people: People,
    private readonly metrics: MetricsService,
  ) {}

  /** An account's plan for a month, if the caller sees the account. */
  async get(
    tx: TenantTx,
    access: Access,
    accountId: string,
    period: string,
  ): Promise<AccountPlanResult> {
    await this.accounts.find(tx, access, accountId);
    return this.result(tx, access.tenantId, accountId, period);
  }

  private async result(
    tx: TenantTx,
    tenantId: string,
    accountId: string,
    period: string,
  ): Promise<AccountPlanResult> {
    const rows = await tx
      .select()
      .from(accountPlans)
      .where(
        and(
          eq(accountPlans.tenantId, tenantId),
          eq(accountPlans.accountId, accountId),
          eq(accountPlans.period, period),
        ),
      )
      .orderBy(desc(accountPlans.updatedAt));
    const last = rows[0];
    const by = last?.updatedBy
      ? (await this.people.facts(tx, tenantId, [last.updatedBy])).get(last.updatedBy)
      : undefined;
    return {
      accountId,
      period,
      metrics: await this.metrics.targetable(tx, tenantId),
      values: Object.fromEntries(rows.map((row) => [row.metricKey, tidy(row.value)])),
      updatedAt: last?.updatedAt.toISOString() ?? null,
      updatedBy: last?.updatedBy ? { id: last.updatedBy, name: by?.name ?? '' } : null,
    };
  }

  /** Problems with plan values, as with targets. */
  async issues(tx: TenantTx, tenantId: string, values: TargetValues, prefix: string[]) {
    return TargetsService.valueIssues(await this.metrics.targetable(tx, tenantId), values, prefix);
  }

  /** Writes values into an account's month; `null` clears one. The caller checked them. */
  async write(
    tx: TenantTx,
    access: Access,
    accountId: string,
    period: string,
    values: TargetValues,
  ): Promise<void> {
    const tenantId = access.tenantId;
    for (const [metricKey, value] of Object.entries(values)) {
      const key = and(
        eq(accountPlans.tenantId, tenantId),
        eq(accountPlans.accountId, accountId),
        eq(accountPlans.period, period),
        eq(accountPlans.metricKey, metricKey),
      );
      if (value === null) {
        await tx.delete(accountPlans).where(key);
      } else {
        await tx
          .insert(accountPlans)
          .values({
            tenantId,
            accountId,
            period,
            metricKey,
            value: value.trim(),
            updatedBy: access.userId,
          })
          .onConflictDoUpdate({
            target: [
              accountPlans.tenantId,
              accountPlans.accountId,
              accountPlans.period,
              accountPlans.metricKey,
            ],
            set: { value: value.trim(), updatedAt: new Date(), updatedBy: access.userId },
          });
      }
    }
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'account_plan.updated',
      target: { type: 'account', id: accountId },
      before: null,
      after: { period, values },
    });
  }

  /** Sets an account's plan for a month (`account_plan.manage`), at an account the caller sees. */
  async put(tx: TenantTx, access: Access, body: PutAccountPlanBody): Promise<AccountPlanResult> {
    await this.accounts.find(tx, access, body.accountId);
    const issues = await this.issues(tx, access.tenantId, body.values, ['values']);
    if (issues.length > 0) {
      throw new AppError('VALIDATION', 'Check the highlighted values.', issues);
    }
    await this.write(tx, access, body.accountId, body.period, body.values);
    return this.result(tx, access.tenantId, body.accountId, body.period);
  }
}
