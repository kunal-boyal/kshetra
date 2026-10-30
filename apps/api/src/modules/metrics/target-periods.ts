import { Injectable } from '@nestjs/common';
import {
  AppError,
  currentPeriod,
  issueAt,
  type PeriodSetting,
  periodDates,
  periodKeyIssue,
  todayIn,
} from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { MetricsService } from './metrics.service';

/** The tenant's target and score periods, as its score definition and financial year set them. */
export interface PeriodRules {
  setting: PeriodSetting | null;
  startMonth: number;
  today: string;
}

/**
 * Target and score periods for a tenant (spec 5.8, decision D108): which kind is in force, the
 * period of a date, and a key's days by the tenant's financial year. Targets, performance, the
 * dashboard and the nightly snapshot all read periods through it.
 */
@Injectable()
export class TargetPeriods {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: TenantConfigService,
  ) {}

  async rules(tx: TenantTx, tenantId: string): Promise<PeriodRules> {
    const settings = await this.config.settings(tx, tenantId);
    return {
      setting: await this.metrics.score(tx, tenantId),
      startMonth: settings.financialYearStartMonth,
      today: todayIn(settings.timezone),
    };
  }

  /** A period's first and last dates. */
  async dates(tx: TenantTx, tenantId: string, key: string): Promise<{ from: string; to: string }> {
    const { startMonth } = await this.rules(tx, tenantId);
    return periodDates(key, startMonth);
  }

  /** The period in force on a date, by default today on the tenant's clock. */
  async current(tx: TenantTx, tenantId: string, date?: string): Promise<string> {
    const rules = await this.rules(tx, tenantId);
    return currentPeriod(rules.setting, date ?? rules.today, rules.startMonth);
  }

  /**
   * Refuses a key of another kind than the one in force on its first day, as a field error at
   * `path`: targets are written only for the periods the tenant counts by.
   */
  async check(
    tx: TenantTx,
    tenantId: string,
    key: string,
    path: (string | number)[] = ['period'],
  ): Promise<void> {
    const { setting, startMonth } = await this.rules(tx, tenantId);
    const issue = periodKeyIssue(key, setting, startMonth);
    if (issue) {
      throw new AppError('VALIDATION', 'This period is not one targets are set for.', [
        issueAt(path, issue),
      ]);
    }
  }
}
