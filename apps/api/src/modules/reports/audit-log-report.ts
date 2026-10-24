import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';
import { AuditService } from '../audit/audit.service';
import { People } from '../iam/people';
import { monthMoments, offsetPage } from './report-helpers';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * The audit log report (M18, M21): every change the people the report covers made in the month,
 * oldest first, with what and where from. For those who may view the audit log.
 */
@Injectable()
export class AuditLogReport extends ReportSource {
  readonly key = 'audit_log' as const;

  constructor(
    private readonly people: People,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'at', label: 'report.col_at', kind: 'datetime' },
      { key: 'actor_code', label: 'report.col_actor_code', kind: 'text' },
      { key: 'actor_name', label: 'report.col_actor_name', kind: 'text' },
      { key: 'action', label: 'report.col_action', kind: 'text' },
      { key: 'target_type', label: 'report.col_target_type', kind: 'text' },
      { key: 'target_id', label: 'report.col_target_id', kind: 'text' },
      { key: 'ip', label: 'report.col_ip', kind: 'text' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const { from, to } = monthMoments(context);
    const rows = await this.audit.reportRows(
      tx,
      context.tenantId,
      context.people,
      from,
      to,
      offset,
      limit,
    );
    const { shown, nextCursor } = offsetPage(rows, offset, limit);
    const people = await this.people.facts(
      tx,
      context.tenantId,
      shown.flatMap((row) => (row.actorId ? [row.actorId] : [])),
    );
    const result: ReportRow[] = shown.map((row) => ({
      at: row.createdAt.toISOString(),
      actor_code: row.actorId ? (people.get(row.actorId)?.code ?? null) : null,
      actor_name: row.actorId ? (people.get(row.actorId)?.name ?? null) : null,
      action: row.action,
      target_type: row.targetType,
      target_id: row.targetId,
      ip: row.ip,
    }));
    return { rows: result, nextCursor };
  }
}
