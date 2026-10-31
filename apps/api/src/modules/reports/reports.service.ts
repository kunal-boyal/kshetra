import { Injectable } from '@nestjs/common';
import { type MessageKey, resolveTerminology, translate } from '@thelamp/i18n';
import {
  AppError,
  EXPORT_MAX_ROWS,
  type Locale,
  type ReportColumn,
  type ReportFilters,
  type ReportKey,
  type ReportPage,
  type ReportQuery,
  REPORT_FOR_ONE_PERSON,
  REPORT_KEYS,
  REPORT_MODULE,
  REPORT_PERMISSION,
} from '@thelamp/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type Access, moduleDisabled } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';
import { ActivityLogReport } from './activity-log';
import { AttendanceRegisterReport } from './attendance-register';
import { ExpenseRegisterReport } from './expense-register';
import { PayrollSummaryReport } from './payroll-summary';
import { LeaveRegisterReport } from './leave-register';
import { VisitComplianceReport } from './visit-compliance';
import { CoverageFrequencyReport } from './coverage-frequency';
import { GpsAuditTrailReport } from './gps-audit-trail';
import { LocationSummaryReport } from './location-summary';
import { OrdersRegisterReport } from './orders-register';
import { AccountStatementReport } from './account-statement';
import { AuditLogReport } from './audit-log-report';
import type { ReportContext, ReportRow, ReportSource } from './sources';
import { TargetAchievementReport } from './target-achievement';

/** The last day of a `YYYY-MM` month. */
function lastDay(period: string): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(day).padStart(2, '0')}`;
}

/**
 * Reports (module M18, decision D62): each report reads only the people the caller's scope
 * reaches, narrowed by the filters, for one month on the tenant's clock; headings and coded values
 * come in the language asked for. Exports read every page through `everyRow`.
 */
@Injectable()
export class ReportsService {
  private readonly sources: Map<ReportKey, ReportSource>;

  constructor(
    private readonly scopes: Scopes,
    private readonly people: People,
    private readonly territories: TerritoriesService,
    private readonly config: TenantConfigService,
    activityLog: ActivityLogReport,
    attendanceRegister: AttendanceRegisterReport,
    targetAchievement: TargetAchievementReport,
    leaveRegister: LeaveRegisterReport,
    expenseRegister: ExpenseRegisterReport,
    visitCompliance: VisitComplianceReport,
    coverageFrequency: CoverageFrequencyReport,
    locationSummary: LocationSummaryReport,
    gpsAuditTrail: GpsAuditTrailReport,
    ordersRegister: OrdersRegisterReport,
    accountStatement: AccountStatementReport,
    auditLog: AuditLogReport,
    payrollSummary: PayrollSummaryReport,
  ) {
    this.sources = new Map<ReportKey, ReportSource>(
      [
        activityLog,
        attendanceRegister,
        targetAchievement,
        leaveRegister,
        expenseRegister,
        visitCompliance,
        coverageFrequency,
        locationSummary,
        gpsAuditTrail,
        ordersRegister,
        accountStatement,
        auditLog,
        payrollSummary,
      ].map((source) => [source.key, source]),
    );
  }

  /** A person named in a filter: another tenant's is not found, and one out of reach is refused. */
  private async reachable(tx: TenantTx, access: Access, userId: string): Promise<void> {
    const found = await this.people.facts(tx, access.tenantId, [userId]);
    if (!found.has(userId)) throw notFound();
    if (!(await this.scopes.reaches(tx, access, userId))) throw outOfScope();
  }

  /** Whose records the report reads: the caller's scope, narrowed by team, territory and person. */
  private async whose(tx: TenantTx, access: Access, filters: ReportFilters): Promise<SQL> {
    const from = `${filters.period}-01`;
    const parts: SQL[] = [await this.scopes.userIds(tx, access)];
    if (filters.managerId) {
      await this.reachable(tx, access, filters.managerId);
      parts.push(this.scopes.teamOf(access.tenantId, filters.managerId));
    }
    if (filters.territoryId) {
      await this.territories.get(tx, access.tenantId, filters.territoryId);
      parts.push(
        this.territories.usersAttachedUnder(
          access.tenantId,
          filters.territoryId,
          from,
          lastDay(filters.period),
        ),
      );
    }
    if (filters.userId) {
      await this.reachable(tx, access, filters.userId);
      parts.push(sql`select ${filters.userId}::uuid`);
    }
    return sql.join(
      parts.map((part) => sql`(${part})`),
      sql` intersect `,
    );
  }

  /**
   * Checks an export before it is queued: its report's module is on, and the people and places
   * its filters name are reachable.
   */
  async check(
    tx: TenantTx,
    access: Access,
    key: ReportKey | 'workbook',
    filters: ReportFilters,
  ): Promise<void> {
    // A workbook takes only the reports the person may see (`visible`), so only its filters count.
    if (key !== 'workbook') this.source(access, key, filters);
    await this.whose(tx, access, filters);
  }

  private async context(
    tx: TenantTx,
    access: Access,
    filters: ReportFilters,
    locale: Locale,
  ): Promise<ReportContext> {
    const { timezone } = await this.config.settings(tx, access.tenantId);
    const terms = resolveTerminology(await this.config.terminology(tx, access.tenantId), locale);
    return {
      tenantId: access.tenantId,
      access,
      filters,
      locale,
      timezone,
      people: await this.whose(tx, access, filters),
      from: `${filters.period}-01`,
      to: lastDay(filters.period),
      text: (key: MessageKey, params?: Record<string, string | number>) =>
        translate(key, { locale, terms, ...(params ? { params } : {}) }),
    };
  }

  /**
   * A report, unless its module is switched off for the caller's tenant (spec 5.13), the caller
   * may not see its records, or it reads one person at a time and the filters name nobody (D99).
   */
  private source(access: Access, key: ReportKey, filters: ReportFilters): ReportSource {
    const module = REPORT_MODULE[key];
    if (module && access.modulesOff.includes(module)) throw moduleDisabled();
    const permission = REPORT_PERMISSION[key];
    if (permission && !access.permissions.has(permission)) {
      throw new AppError('FORBIDDEN', 'You may not see this report.');
    }
    if (REPORT_FOR_ONE_PERSON.includes(key) && !filters.userId) {
      throw new AppError('VALIDATION', 'This report reads one person at a time.', [
        { path: 'userId', issue: 'Choose a person' },
      ]);
    }
    return this.sources.get(key)!;
  }

  private async columns(
    tx: TenantTx,
    source: ReportSource,
    context: ReportContext,
  ): Promise<ReportColumn[]> {
    return (await source.columns(tx, context)).map((column) => ({
      key: column.key,
      label:
        typeof column.label === 'string'
          ? context.text(column.label)
          : column.label[context.locale],
      kind: column.kind,
      ...(column.tones
        ? {
            tones: Object.fromEntries(
              Object.entries(column.tones).map(([key, tone]) => [
                context.text(key as MessageKey),
                tone,
              ]),
            ),
          }
        : {}),
    }));
  }

  /** One page of a report, as the screen reads it. */
  async page(
    tx: TenantTx,
    access: Access,
    key: ReportKey,
    query: ReportQuery,
  ): Promise<ReportPage> {
    const { cursor, limit, locale, ...filters } = query;
    const source = this.source(access, key, filters);
    const context = await this.context(tx, access, filters, locale);
    const columns = await this.columns(tx, source, context);
    const found = await source.page(tx, context, cursor, limit);
    return {
      report: key,
      period: filters.period,
      columns,
      rows: found.rows,
      nextCursor: found.nextCursor,
    };
  }

  /**
   * The report's name, columns and every row, for a file; at most `most` (by default
   * `EXPORT_MAX_ROWS`, else the plan's, decision D98), past which `truncated` says so.
   */
  async everyRow(
    tx: TenantTx,
    access: Access,
    key: ReportKey,
    filters: ReportFilters,
    locale: Locale,
    most = EXPORT_MAX_ROWS,
  ): Promise<{
    name: string;
    timezone: string;
    columns: ReportColumn[];
    rows: ReportRow[];
    truncated: boolean;
  }> {
    const source = this.source(access, key, filters);
    const context = await this.context(tx, access, filters, locale);
    const columns = await this.columns(tx, source, context);
    const rows: ReportRow[] = [];
    let cursor: string | undefined;
    do {
      const found = await source.page(tx, context, cursor, 500);
      rows.push(...found.rows);
      cursor = found.nextCursor ?? undefined;
    } while (cursor !== undefined && rows.length < most);
    return {
      name: context.text(`report.name_${key}`),
      timezone: context.timezone,
      columns,
      rows: rows.slice(0, most),
      truncated: rows.length > most || cursor !== undefined,
    };
  }

  /**
   * The reports a person may export with these filters, in the order of `REPORT_KEYS`: those of
   * modules on, whose records they may see, and those read one person at a time only when the
   * filters name one (decision D112).
   */
  visible(access: Access, filters: ReportFilters): ReportKey[] {
    return REPORT_KEYS.filter((key) => {
      const module = REPORT_MODULE[key];
      const permission = REPORT_PERMISSION[key];
      return (
        (!module || !access.modulesOff.includes(module)) &&
        (!permission || access.permissions.has(permission)) &&
        (!REPORT_FOR_ONE_PERSON.includes(key) || filters.userId !== undefined)
      );
    });
  }

  /**
   * Every report the person may see, a sheet each, for a workbook (phase 4 step A3, decision
   * D112): each with the filters every report takes (the month and whose), at most `most` rows in
   * all, a report that would run past them cut where they end.
   */
  async everyReport(
    tx: TenantTx,
    access: Access,
    filters: ReportFilters,
    locale: Locale,
    most = EXPORT_MAX_ROWS,
  ): Promise<{
    timezone: string;
    sheets: { name: string; columns: ReportColumn[]; rows: ReportRow[] }[];
  }> {
    const { period, managerId, territoryId, userId } = filters;
    const shared: ReportFilters = {
      period,
      ...(managerId ? { managerId } : {}),
      ...(territoryId ? { territoryId } : {}),
      ...(userId ? { userId } : {}),
    };
    const sheets: { name: string; columns: ReportColumn[]; rows: ReportRow[] }[] = [];
    let timezone = 'Asia/Kolkata';
    let left = most;
    for (const key of this.visible(access, shared)) {
      const found = await this.everyRow(tx, access, key, shared, locale, Math.max(left, 0));
      timezone = found.timezone;
      sheets.push({ name: found.name, columns: found.columns, rows: found.rows });
      left -= found.rows.length;
    }
    return { timezone, sheets };
  }

  /** A report's name in a language, with the tenant's terms. */
  async name(tx: TenantTx, tenantId: string, key: ReportKey, locale: Locale): Promise<string> {
    const terms = resolveTerminology(await this.config.terminology(tx, tenantId), locale);
    return translate(`report.name_${key}`, { locale, terms });
  }
}
