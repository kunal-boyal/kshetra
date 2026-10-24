import { Injectable } from '@nestjs/common';
import { todayIn } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { AccountTypesService } from '../accounts/account-types.service';
import { VisitsService } from '../field/visits.service';
import { People } from '../iam/people';
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
 * Coverage and frequency (M18): each account a person is assigned to, by a slot they fill on the
 * month's last day (or today, in the month under way), with the visits they completed there in
 * the month, the last one, and whether it was covered at all. Type and segments are its own.
 */
@Injectable()
export class CoverageFrequencyReport extends ReportSource {
  readonly key = 'coverage_frequency' as const;

  constructor(
    private readonly people: People,
    private readonly accounts: AccountsService,
    private readonly types: AccountTypesService,
    private readonly visits: VisitsService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'account_code', label: 'report.col_account_code', kind: 'text' },
      { key: 'account_name', label: 'report.col_account_name', kind: 'text' },
      { key: 'account_type', label: 'report.col_account_type', kind: 'text' },
      { key: 'segments', label: 'report.col_segments', kind: 'text' },
      { key: 'visits', label: 'report.col_visits', kind: 'number' },
      { key: 'last_visit', label: 'report.col_last_visit', kind: 'date' },
      { key: 'covered', label: 'report.col_covered', kind: 'boolean' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const today = todayIn(context.timezone);
    const day = context.to < today ? context.to : today;
    const held = await this.accounts.slotsHeld(
      tx,
      context.tenantId,
      context.people,
      day,
      offset,
      limit,
    );
    const { shown, nextCursor } = offsetPage(held, offset, limit);
    const userIds = [...new Set(shown.map((row) => row.userId))];
    const people = await this.people.facts(tx, context.tenantId, userIds);
    const accounts = await this.accounts.forReport(
      tx,
      context.tenantId,
      shown.map((row) => row.accountId),
    );
    const visits = await this.visits.completed(
      tx,
      context.tenantId,
      userIds,
      context.from,
      context.to,
      context.timezone,
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
      const seen = visits.get(`${row.userId}|${row.accountId}`);
      return [
        {
          user_code: people.get(row.userId)?.code ?? null,
          user_name: people.get(row.userId)?.name ?? null,
          account_code: account?.code ?? null,
          account_name: account?.name ?? null,
          account_type: account ? (typeNames.get(account.typeKey) ?? account.typeKey) : null,
          segments: account?.segments.join(', ') ?? null,
          visits: seen?.visits ?? 0,
          last_visit: seen?.last ?? null,
          covered: seen !== undefined,
        },
      ];
    });
    return { rows: result, nextCursor };
  }
}
