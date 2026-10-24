import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { AccountTypesService } from '../accounts/account-types.service';
import { People } from '../iam/people';
import { PlanningService } from '../planning/planning.service';
import { offsetPage } from './report-helpers';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * Visit compliance (M18): every plan item of the month, planned against completed and missed, by
 * day, person and account, with how it was planned.
 */
@Injectable()
export class VisitComplianceReport extends ReportSource {
  readonly key = 'visit_compliance' as const;

  constructor(
    private readonly people: People,
    private readonly planning: PlanningService,
    private readonly accounts: AccountsService,
    private readonly types: AccountTypesService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'date', label: 'report.col_date', kind: 'date' },
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'account_code', label: 'report.col_account_code', kind: 'text' },
      { key: 'account_name', label: 'report.col_account_name', kind: 'text' },
      { key: 'account_type', label: 'report.col_account_type', kind: 'text' },
      { key: 'purpose', label: 'report.col_purpose', kind: 'text' },
      { key: 'planned_by', label: 'report.col_planned_by', kind: 'text' },
      { key: 'plan_status', label: 'report.col_plan_status', kind: 'text' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const rows = await this.planning.complianceRows(
      tx,
      context.tenantId,
      context.people,
      context.from,
      context.to,
      offset,
      limit,
    );
    const { shown, nextCursor } = offsetPage(rows, offset, limit);
    const people = await this.people.facts(
      tx,
      context.tenantId,
      shown.map((row) => row.userId),
    );
    const accounts = await this.accounts.forReport(
      tx,
      context.tenantId,
      shown.map((row) => row.accountId),
    );
    const typeNames = new Map(
      (await this.types.list(tx, context.tenantId)).map((type) => [
        type.key,
        type.definition.name[context.locale].one,
      ]),
    );
    const wanted = context.filters.accountType;
    const result: ReportRow[] = shown.flatMap((row) => {
      const account = accounts.get(row.accountId);
      if (wanted && account?.typeKey !== wanted) return [];
      return [
        {
          date: row.date,
          user_code: people.get(row.userId)?.code ?? null,
          user_name: people.get(row.userId)?.name ?? null,
          account_code: account?.code ?? null,
          account_name: account?.name ?? null,
          account_type: account ? (typeNames.get(account.typeKey) ?? account.typeKey) : null,
          purpose: row.purpose,
          planned_by: context.text(`report.source_${row.source}`),
          plan_status: context.text(`plan.status_${row.status}`),
        },
      ];
    });
    return { rows: result, nextCursor };
  }
}
