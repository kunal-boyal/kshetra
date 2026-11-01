import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FORECAST_MONTHS, shiftPeriod, type SyncForecast, todayIn } from '@thelamp/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { forecastLines, forecasts } from '../../db/schema/forecasts';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { plain } from './forecasts.service';

/**
 * What a phone keeps of forecasts (BR-54, decision D126): the latest version of this month's and
 * the next three months' forecast of each account its person sees, so the forecast screen works
 * offline. Only for people who record them; the scope follows the accounts they see and the month,
 * so a new month starts a fresh copy.
 */
@Injectable()
export class ForecastsSync implements SyncSource<SyncForecast>, OnModuleInit {
  readonly name = 'forecasts';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly accounts: AccountsService,
    private readonly config: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  private async months(tx: TenantTx, tenantId: string): Promise<string[]> {
    const month = todayIn((await this.config.settings(tx, tenantId)).timezone).slice(0, 7);
    return Array.from({ length: FORECAST_MONTHS + 1 }, (_, index) => shiftPeriod(month, index));
  }

  async scope(tx: TenantTx, access: Access): Promise<string> {
    if (!access.permissions.has('forecast.record')) return 'none';
    const [month] = await this.months(tx, access.tenantId);
    return `${await this.accounts.reachHash(tx, access)}:${month}`;
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncForecast>[]> {
    if (!access.permissions.has('forecast.record')) return [];
    const reach = await this.accounts.reachIds(tx, access);
    const found = await tx
      .select()
      .from(forecasts)
      .where(
        and(
          eq(forecasts.tenantId, access.tenantId),
          inArray(forecasts.period, await this.months(tx, access.tenantId)),
          sql`${forecasts.accountId}::text in (${reach})`,
          sql`not exists (
            select 1 from ${forecasts} later
             where later.tenant_id = ${forecasts.tenantId}
               and later.account_id = ${forecasts.accountId}
               and later.period = ${forecasts.period}
               and later.version > ${forecasts.version})`,
          sql`${forecasts.rowVersion} >= ${page.since}`,
          page.after
            ? sql`(${forecasts.rowVersion}, ${forecasts.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : sql`true`,
        ),
      )
      .orderBy(forecasts.rowVersion, forecasts.id)
      .limit(page.limit);
    const lines = found.length
      ? await tx
          .select()
          .from(forecastLines)
          .where(
            and(
              eq(forecastLines.tenantId, access.tenantId),
              inArray(
                forecastLines.forecastId,
                found.map((row) => row.id),
              ),
            ),
          )
      : [];
    return found.map((forecast) => ({
      version: Number(forecast.rowVersion),
      id: forecast.id,
      row: {
        id: forecast.id,
        accountId: forecast.accountId,
        period: forecast.period,
        version: forecast.version,
        recordedAt: forecast.recordedAt.toISOString(),
        lines: lines
          .filter((line) => line.forecastId === forecast.id)
          .map((line) => ({ itemId: line.itemId, quantity: plain(line.quantity) })),
      },
    }));
  }
}
