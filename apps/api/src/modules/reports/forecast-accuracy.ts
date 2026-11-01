import { Injectable } from '@nestjs/common';
import { forecastAccuracy, forecastGap, scaled, unscaled } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { PriceListsService } from '../catalogue/price-lists.service';
import { ForecastsService } from '../forecasts/forecasts.service';
import { OrdersService } from '../orders/orders.service';
import { AccountPlansService } from '../planning/account-plans.service';
import { SellThroughService } from '../sell-through/sell-through.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/** How many accounts a page reads; each brings its items. */
const ACCOUNTS_A_PAGE = 20;

/**
 * Forecast accuracy (M18, BR-54, decision D126): each account with a forecast for the month, item
 * by item, against what it ordered (while the orders module is on, else what it sold through, D124)
 * and what it sold through, with the gap and the account's weighted accuracy; and, where the tenant
 * names a plan metric, the forecast's value at its prices beside its account plan.
 */
@Injectable()
export class ForecastAccuracyReport extends ReportSource {
  readonly key = 'forecast_accuracy' as const;

  constructor(
    private readonly accounts: AccountsService,
    private readonly forecasts: ForecastsService,
    private readonly orders: OrdersService,
    private readonly sellThrough: SellThroughService,
    private readonly plans: AccountPlansService,
    private readonly prices: PriceListsService,
    private readonly catalogue: CatalogueService,
    private readonly config: TenantConfigService,
  ) {
    super();
  }

  private async options(tx: TenantTx, context: ReportContext) {
    const settings = await this.config.settings(tx, context.tenantId);
    return {
      ordersOn: !settings.modulesOff.includes('orders'),
      planMetric: settings.forecastPlanMetric,
    };
  }

  async columns(tx: TenantTx, context: ReportContext): Promise<ColumnSpec[]> {
    const { ordersOn, planMetric } = await this.options(tx, context);
    return [
      { key: 'account_code', label: 'report.col_account_code', kind: 'text' },
      { key: 'account_name', label: 'report.col_account_name', kind: 'text' },
      { key: 'account_type', label: 'report.col_account_type', kind: 'text' },
      { key: 'item_code', label: 'report.col_item_code', kind: 'text' },
      { key: 'item_name', label: 'report.col_item_name', kind: 'text' },
      { key: 'forecast', label: 'report.col_forecast', kind: 'decimal' },
      ...(ordersOn
        ? [{ key: 'ordered', label: 'report.col_ordered', kind: 'decimal' } as ColumnSpec]
        : []),
      { key: 'sold', label: 'report.col_sold', kind: 'decimal' },
      { key: 'gap', label: 'report.col_gap', kind: 'decimal' },
      { key: 'gap_share', label: 'report.col_gap_share', kind: 'percent' },
      { key: 'accuracy', label: 'report.col_forecast_accuracy', kind: 'percent' },
      ...(planMetric
        ? ([
            { key: 'forecast_value', label: 'report.col_forecast_value', kind: 'decimal' },
            { key: 'plan_value', label: 'report.col_plan_value', kind: 'decimal' },
          ] as ColumnSpec[])
        : []),
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const period = context.from.slice(0, 7);
    const { ordersOn, planMetric } = await this.options(tx, context);
    const size = Math.max(1, Math.min(ACCOUNTS_A_PAGE, limit));
    const { rows, more } = await this.forecasts.forReport(
      tx,
      context.tenantId,
      await this.accounts.reachIds(tx, context.access),
      period,
      offset,
      size,
    );
    const ids = rows.map((row) => row.accountId);
    const accounts = await this.accounts.forReport(tx, context.tenantId, ids);
    const ordered = ordersOn
      ? await this.orders.orderedFor(tx, context.tenantId, ids, period, context.timezone)
      : new Map<string, Map<string, string>>();
    const sold = await this.sellThrough.soldFor(tx, context.tenantId, ids, period);
    const plans = planMetric
      ? await this.plans.valuesOf(tx, context.tenantId, ids, period, planMetric)
      : new Map<string, string>();
    const items = new Map(
      (await this.catalogue.items(tx, context.tenantId)).map((item) => [item.id, item]),
    );
    const wanted = context.filters.accountType;
    const percent = (share: number | null) =>
      share === null ? null : Math.round(share * 10_000) / 100;
    const result: ReportRow[] = [];
    for (const row of rows) {
      const account = accounts.get(row.accountId);
      if (wanted && account?.typeKey !== wanted) continue;
      // What actually came: orders while that module is on, else what sold through (D124).
      const actuals = (ordersOn ? ordered : sold).get(row.accountId) ?? new Map<string, string>();
      const itemIds = [...new Set([...row.items.keys(), ...actuals.keys()])];
      const accuracy = forecastAccuracy(
        itemIds.map((itemId) => ({
          forecast: row.items.get(itemId) ?? '0',
          actual: actuals.get(itemId) ?? '0',
        })),
      );
      let forecastValue: string | null = null;
      if (planMetric) {
        const rates = new Map(
          (
            await this.prices.forAccount(tx, context.access, row.accountId, `${period}-01`)
          ).items.map((entry) => [entry.itemId, entry.rate]),
        );
        let total = 0n;
        for (const [itemId, quantity] of row.items) {
          const rate = rates.get(itemId);
          if (rate) total += (scaled(quantity, 3) * scaled(rate, 2) + 500n) / 1000n;
        }
        forecastValue = unscaled(total, 2);
      }
      for (const itemId of itemIds.sort((a, b) =>
        (items.get(a)?.code ?? '').localeCompare(items.get(b)?.code ?? ''),
      )) {
        const forecast = row.items.get(itemId) ?? '0';
        const gap = forecastGap(forecast, actuals.get(itemId) ?? '0');
        result.push({
          account_code: account?.code ?? null,
          account_name: account?.name ?? null,
          account_type: account?.typeKey ?? null,
          item_code: items.get(itemId)?.code ?? null,
          item_name: items.get(itemId)?.name ?? null,
          forecast: Number(forecast),
          ...(ordersOn ? { ordered: Number(ordered.get(row.accountId)?.get(itemId) ?? 0) } : {}),
          sold: sold.get(row.accountId)?.has(itemId)
            ? Number(sold.get(row.accountId)!.get(itemId))
            : null,
          gap: Number(gap.quantity),
          gap_share: percent(gap.share),
          accuracy: percent(accuracy),
          ...(planMetric
            ? {
                forecast_value: forecastValue === null ? null : Number(forecastValue),
                plan_value: plans.has(row.accountId) ? Number(plans.get(row.accountId)) : null,
              }
            : {}),
        });
      }
    }
    return { rows: result, nextCursor: more ? String(offset + size) : null };
  }
}
