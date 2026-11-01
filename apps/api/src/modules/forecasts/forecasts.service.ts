import { Injectable } from '@nestjs/common';
import {
  AppError,
  type ForecastLineBody,
  forecastAfterLock,
  forecastMonths,
  forecastOpen,
  type ForecastResult,
  type ForecastVersion,
  scaled,
  shiftPeriod,
  todayIn,
} from '@thelamp/shared';
import { and, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import { forecastLines, forecasts } from '../../db/schema/forecasts';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { invalid } from '../iam/actor';
import { People } from '../iam/people';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

type Forecast = typeof forecasts.$inferSelect;

/** Numbers as the database keeps them, back to plain decimal strings. */
export const plain = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  const kept = fraction.replace(/0+$/, '');
  return kept ? `${whole}.${kept}` : whole;
};

/** What one person or file sends for an account's month. */
export interface ForecastInput {
  id: string;
  accountId: string;
  period: string;
  lines: readonly ForecastLineBody[];
  reason?: string;
  /** Whose forecast it is; the caller's own when left out. */
  recordedBy?: string;
}

/** The latest version of each account's month: no later version of it exists. */
const latestOnly = sql`not exists (
  select 1 from ${forecasts} later
   where later.tenant_id = ${forecasts.tenantId}
     and later.account_id = ${forecasts.accountId}
     and later.period = ${forecasts.period}
     and later.version > ${forecasts.version})`;

/**
 * Product forecasts per account (BR-54, decision D126): each account's expected quantity by
 * item for the coming months, kept as versions; the latest counts. A month locks on its 1st, after
 * which only someone with `forecast.adjust` changes it, with a reason.
 */
@Injectable()
export class ForecastsService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly catalogue: CatalogueService,
    private readonly people: People,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  private async today(tx: TenantTx, tenantId: string): Promise<string> {
    return todayIn((await this.config.settings(tx, tenantId)).timezone);
  }

  private async versions(
    tx: TenantTx,
    tenantId: string,
    accountId: string,
    period: string,
  ): Promise<Forecast[]> {
    return tx
      .select()
      .from(forecasts)
      .where(
        and(
          eq(forecasts.tenantId, tenantId),
          eq(forecasts.accountId, accountId),
          eq(forecasts.period, period),
        ),
      )
      .orderBy(desc(forecasts.version));
  }

  /**
   * Saves a new version of an account's month: the quantities sent over the latest version's
   * others, 0 taking an item out. Refused past the window or, after the lock, without the
   * override; the override needs a reason.
   */
  async record(tx: TenantTx, access: Access, input: ForecastInput): Promise<ForecastResult> {
    const tenantId = access.tenantId;
    await this.accounts.find(tx, access, input.accountId);
    const recordedBy = input.recordedBy ?? access.userId;
    if (!input.recordedBy && (access.support || access.apiClient)) {
      throw new AppError('FORBIDDEN', 'Only a person of the organisation records a forecast.');
    }
    const today = await this.today(tx, tenantId);
    const window = forecastMonths(today);
    if (input.period > window[window.length - 1]!) {
      throw invalid('period', `Forecast the next ${window.length} months only`);
    }
    const thisMonth = today.slice(0, 7);
    const override = access.permissions.has('forecast.adjust');
    if (input.period < thisMonth || !forecastOpen(input.period, today, override)) {
      throw new AppError('PERIOD_CLOSED', 'That month’s forecast is locked.');
    }
    const afterLock = forecastAfterLock(input.period, today);
    if (afterLock && !input.reason) throw invalid('reason', 'Say why the locked month changes');
    const items = new Map(
      (await this.catalogue.items(tx, tenantId)).map((item) => [item.id, item]),
    );
    input.lines.forEach((line, index) => {
      if (!items.get(line.itemId)?.active) {
        throw invalid(`lines[${index}].itemId`, 'There is no such item');
      }
    });
    // One account's month takes turns, so two saves never take the same version number.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`forecast:${tenantId}:${input.accountId}:${input.period}`}, 0))`,
    );
    const [latest] = await this.versions(tx, tenantId, input.accountId, input.period);
    const merged = new Map<string, string>();
    if (latest) {
      for (const line of await this.linesOf(tx, tenantId, [latest.id])) {
        merged.set(line.itemId, plain(line.quantity));
      }
    }
    for (const line of input.lines) {
      if (scaled(line.quantity, 3) === 0n) merged.delete(line.itemId);
      else merged.set(line.itemId, line.quantity);
    }
    const version = (latest?.version ?? 0) + 1;
    await tx.insert(forecasts).values({
      id: input.id,
      tenantId,
      accountId: input.accountId,
      period: input.period,
      version,
      recordedBy,
      reason: input.reason ?? null,
      afterLock,
    });
    if (merged.size > 0) {
      await tx.insert(forecastLines).values(
        [...merged].map(([itemId, quantity]) => ({
          tenantId,
          forecastId: input.id,
          itemId,
          quantity,
        })),
      );
    }
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'forecast.recorded',
      target: { type: 'account', id: input.accountId },
      after: {
        period: input.period,
        version,
        lines: input.lines.length,
        afterLock,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    });
    return this.get(tx, access, input.accountId, input.period, input.period);
  }

  private async linesOf(tx: TenantTx, tenantId: string, ids: readonly string[]) {
    if (ids.length === 0) return [];
    return tx
      .select()
      .from(forecastLines)
      .where(
        and(eq(forecastLines.tenantId, tenantId), inArray(forecastLines.forecastId, [...ids])),
      );
  }

  /** An account's months from `from` to `to`: each one's latest items and every version. */
  async get(
    tx: TenantTx,
    access: Access,
    accountId: string,
    from: string,
    to: string,
  ): Promise<ForecastResult> {
    const tenantId = access.tenantId;
    const account = await this.accounts.find(tx, access, accountId);
    if (to < from) throw invalid('to', 'End on or after the first month');
    if (shiftPeriod(from, 12) <= to) throw invalid('to', 'Ask for a year at most');
    const rows = await tx
      .select()
      .from(forecasts)
      .where(
        and(
          eq(forecasts.tenantId, tenantId),
          eq(forecasts.accountId, accountId),
          gte(forecasts.period, from),
          lte(forecasts.period, to),
        ),
      )
      .orderBy(forecasts.period, desc(forecasts.version));
    const latestIds = new Map<string, string>();
    for (const row of rows) if (!latestIds.has(row.period)) latestIds.set(row.period, row.id);
    const lines = await this.linesOf(tx, tenantId, [...latestIds.values()]);
    const items = new Map(
      (await this.catalogue.items(tx, tenantId)).map((item) => [item.id, item]),
    );
    const people = await this.people.facts(
      tx,
      tenantId,
      rows.map((row) => row.recordedBy),
    );
    const today = await this.today(tx, tenantId);
    const versionOf = (row: Forecast): ForecastVersion => ({
      id: row.id,
      version: row.version,
      recordedBy: {
        id: row.recordedBy,
        code: people.get(row.recordedBy)?.code ?? '',
        name: people.get(row.recordedBy)?.name ?? '',
      },
      recordedAt: row.recordedAt.toISOString(),
      reason: row.reason,
      afterLock: row.afterLock,
    });
    const months: ForecastResult['months'] = [];
    for (let period = from; period <= to; period = shiftPeriod(period, 1)) {
      const id = latestIds.get(period);
      months.push({
        period,
        open: forecastOpen(period, today, false),
        lines: lines
          .filter((line) => line.forecastId === id)
          .map((line) => {
            const item = items.get(line.itemId);
            return {
              item: {
                id: line.itemId,
                code: item?.code ?? '',
                name: item?.name ?? '',
                baseUnit: item?.baseUnit ?? '',
              },
              quantity: plain(line.quantity),
            };
          })
          .sort((a, b) => a.item.code.localeCompare(b.item.code)),
        versions: rows.filter((row) => row.period === period).map(versionOf),
      });
    }
    return { account: { id: account.id, code: account.code, name: account.name }, months };
  }

  /**
   * The accounts in `accounts` (a subquery of IDs the caller reaches) with a forecast for a month,
   * a page at a time, with each one's latest quantities by item: the accuracy report's rows.
   */
  async forReport(
    tx: TenantTx,
    tenantId: string,
    accounts: SQL,
    period: string,
    offset: number,
    limit: number,
  ): Promise<{ more: boolean; rows: { accountId: string; items: Map<string, string> }[] }> {
    const found = await tx
      .select({ id: forecasts.id, accountId: forecasts.accountId })
      .from(forecasts)
      .where(
        and(
          eq(forecasts.tenantId, tenantId),
          eq(forecasts.period, period),
          sql`${forecasts.accountId}::text in (${accounts})`,
          latestOnly,
        ),
      )
      .orderBy(forecasts.accountId)
      .offset(offset)
      .limit(limit + 1);
    const page = found.slice(0, limit);
    const lines = await this.linesOf(
      tx,
      tenantId,
      page.map((row) => row.id),
    );
    return {
      more: found.length > limit,
      rows: page.map((row) => ({
        accountId: row.accountId,
        items: new Map(
          lines
            .filter((line) => line.forecastId === row.id)
            .map((line) => [line.itemId, plain(line.quantity)]),
        ),
      })),
    };
  }
}
