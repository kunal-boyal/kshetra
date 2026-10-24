import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';
import { People } from '../iam/people';
import { LeaveRequestsService } from '../leave/leave-requests.service';
import { LeaveTypesService } from '../leave/leave-types.service';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * The leave register (M18): every leave request that touches the month, by the people the report
 * covers, with its type, days, state and when it was asked for and decided. Balances are on each
 * person's page.
 */
@Injectable()
export class LeaveRegisterReport extends ReportSource {
  readonly key = 'leave_register' as const;

  constructor(
    private readonly people: People,
    private readonly requests: LeaveRequestsService,
    private readonly types: LeaveTypesService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'leave_type', label: 'report.col_leave_type', kind: 'text' },
      { key: 'paid', label: 'report.col_paid', kind: 'boolean' },
      { key: 'start_date', label: 'report.col_start_date', kind: 'date' },
      { key: 'end_date', label: 'report.col_end_date', kind: 'date' },
      { key: 'half_day', label: 'report.col_half_day', kind: 'boolean' },
      { key: 'days', label: 'report.col_days', kind: 'decimal' },
      { key: 'status', label: 'report.col_status', kind: 'text' },
      { key: 'requested_at', label: 'report.col_requested_at', kind: 'datetime' },
      { key: 'decided_at', label: 'report.col_decided_at', kind: 'datetime' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const rows = await this.requests.register(
      tx,
      context.tenantId,
      context.people,
      context.from,
      context.to,
      offset,
      limit,
    );
    const shown = rows.slice(0, limit);
    const people = await this.people.facts(
      tx,
      context.tenantId,
      shown.map((row) => row.userId),
    );
    const types = new Map(
      (await this.types.list(tx, context.tenantId)).map((type) => [type.key, type]),
    );
    const result: ReportRow[] = shown.map((row) => {
      const type = types.get(row.leaveTypeKey);
      return {
        user_code: people.get(row.userId)?.code ?? null,
        user_name: people.get(row.userId)?.name ?? null,
        leave_type: type ? type.name[context.locale] : row.leaveTypeKey,
        paid: type?.paid ?? null,
        start_date: row.startDate,
        end_date: row.endDate,
        half_day: row.halfDay,
        days: Number(row.days),
        status: context.text(
          `approval.status_${row.state as 'pending' | 'approved' | 'rejected' | 'cancelled'}`,
        ),
        requested_at: row.createdAt.toISOString(),
        decided_at: row.decidedAt?.toISOString() ?? null,
      };
    });
    return {
      rows: result,
      nextCursor: rows.length > limit ? String(offset + limit) : null,
    };
  }
}
