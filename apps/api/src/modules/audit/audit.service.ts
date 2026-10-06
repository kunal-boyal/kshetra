import { Injectable } from '@nestjs/common';
import {
  type AuditAction,
  type AuditEntry,
  type AuditListQuery,
  type AuditListResult,
  AppError,
} from '@kshetra/shared';
import { and, desc, eq, gte, lt, or, type SQL, sql } from 'drizzle-orm';
import { auditLog } from '../../db/audit-log';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { Scopes } from '../iam/scopes';

/** The exact time an entry was written, to the microsecond, so paging never skips or repeats. */
const exactTime = sql<string>`to_char(${auditLog.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString('base64url');
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string'
    ) {
      return [value[0], value[1]];
    }
  } catch {
    // Falls through to the error below.
  }
  throw new AppError('VALIDATION', 'Check the highlighted fields.', [
    { path: 'cursor', issue: 'Use the nextCursor of an earlier page' },
  ]);
}

/**
 * Reading the audit log (module M21). Someone who reaches the whole tenant sees every entry; a
 * narrower scope sees the entries of the people it reaches.
 */
@Injectable()
export class AuditService {
  constructor(private readonly scopes: Scopes) {}

  async list(tx: TenantTx, access: Access, query: AuditListQuery): Promise<AuditListResult> {
    const filters: (SQL | undefined)[] = [
      eq(auditLog.tenantId, access.tenantId),
      query.action ? eq(auditLog.action, query.action) : undefined,
      query.targetType ? eq(auditLog.targetType, query.targetType) : undefined,
      query.targetId ? eq(auditLog.targetId, query.targetId) : undefined,
      query.actorId ? eq(auditLog.actorId, query.actorId) : undefined,
      query.from ? gte(auditLog.createdAt, new Date(query.from)) : undefined,
      query.to ? lt(auditLog.createdAt, new Date(query.to)) : undefined,
    ];
    if (access.scope !== 'tenant') {
      filters.push(sql`${auditLog.actorId} in (${await this.scopes.userIds(tx, access)})`);
    }
    if (query.cursor) {
      const [at, id] = decodeCursor(query.cursor);
      filters.push(
        or(
          lt(auditLog.createdAt, sql`${at}::timestamptz`),
          and(eq(auditLog.createdAt, sql`${at}::timestamptz`), lt(auditLog.id, id)),
        ),
      );
    }
    const rows = await tx
      .select({
        id: auditLog.id,
        actorKind: auditLog.actorKind,
        actorId: auditLog.actorId,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        before: auditLog.before,
        after: auditLog.after,
        ip: auditLog.ip,
        deviceId: auditLog.deviceId,
        supportGrantId: auditLog.supportGrantId,
        at: exactTime,
      })
      .from(auditLog)
      .where(and(...filters))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row): AuditEntry => ({
        id: row.id,
        actor: { kind: row.actorKind, id: row.actorId },
        action: row.action as AuditAction,
        target: { type: row.targetType, id: row.targetId },
        before: row.before,
        after: row.after,
        ip: row.ip,
        deviceId: row.deviceId,
        supportGrantId: row.supportGrantId,
        createdAt: row.at,
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.at, last.id) : null,
    };
  }
}
