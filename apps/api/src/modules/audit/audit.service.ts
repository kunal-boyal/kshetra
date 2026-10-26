import { Injectable } from '@nestjs/common';
import {
  type AuditAction,
  type AuditEntry,
  type AuditListQuery,
  type AuditListResult,
  AppError,
  type UserHistoryQuery,
} from '@thelamp/shared';
import { and, desc, eq, gte, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import { auditLog } from '../../db/audit-log';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { startOfLocalDate } from '../../platform/local-day';
import { ApiClientsService } from '../iam/api-clients.service';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { UsersService } from '../iam/users.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

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
  constructor(
    private readonly scopes: Scopes,
    private readonly users: UsersService,
    private readonly people: People,
    private readonly clients: ApiClientsService,
    private readonly config: TenantConfigService,
  ) {}

  async list(tx: TenantTx, access: Access, query: AuditListQuery): Promise<AuditListResult> {
    const filters: (SQL | undefined)[] = [
      eq(auditLog.tenantId, access.tenantId),
      query.action ? eq(auditLog.action, query.action) : undefined,
      query.targetType ? eq(auditLog.targetType, query.targetType) : undefined,
      query.targetId ? eq(auditLog.targetId, query.targetId) : undefined,
      query.actorId ? eq(auditLog.actorId, query.actorId) : undefined,
      query.supportGrantId ? eq(auditLog.supportGrantId, query.supportGrantId) : undefined,
      query.actorKind ? eq(auditLog.actorKind, query.actorKind) : undefined,
      query.from ? gte(auditLog.createdAt, new Date(query.from)) : undefined,
      query.to ? lt(auditLog.createdAt, new Date(query.to)) : undefined,
    ];
    if (query.period) {
      // The month on the tenant's clock, from its first moment to the next month's.
      const { timezone } = await this.config.settings(tx, access.tenantId);
      const [year, month] = query.period.split('-').map(Number) as [number, number];
      const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      filters.push(
        gte(auditLog.createdAt, startOfLocalDate(`${query.period}-01`, timezone)),
        lt(auditLog.createdAt, startOfLocalDate(next, timezone)),
      );
    }
    if (access.scope !== 'tenant') {
      filters.push(sql`${auditLog.actorId} in (${await this.scopes.userIds(tx, access)})`);
    }
    return this.page(tx, access.tenantId, filters, query);
  }

  /**
   * The audit log report (M18, decision D95): what people among `people` changed from `from` to
   * `to`, and with `others` what the system, vendor staff and API clients changed too; one action
   * or kind of actor if asked; oldest first, a page at a time.
   */
  async reportRows(
    tx: TenantTx,
    tenantId: string,
    people: SQL,
    from: Date,
    to: Date,
    offset: number,
    limit: number,
    narrow: {
      others: boolean;
      action?: AuditAction | undefined;
      actorKind?: string | undefined;
    } = {
      others: false,
    },
  ) {
    return tx
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
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tenantId, tenantId),
          narrow.others
            ? or(sql`${auditLog.actorId} in (${people})`, ne(auditLog.actorKind, 'user'))
            : sql`${auditLog.actorId} in (${people})`,
          narrow.action ? eq(auditLog.action, narrow.action) : undefined,
          narrow.actorKind
            ? eq(auditLog.actorKind, narrow.actorKind as AuditEntry['actor']['kind'])
            : undefined,
          gte(auditLog.createdAt, from),
          lt(auditLog.createdAt, to),
        ),
      )
      .orderBy(auditLog.createdAt, auditLog.id)
      .offset(offset)
      .limit(limit + 1);
  }

  /** The names of these API clients, by ID, for the report. */
  async clientNames(tx: TenantTx, tenantId: string, ids: readonly string[]) {
    const names = new Map<string, string>();
    for (const id of new Set(ids)) {
      const client = await this.clients.state(tx, tenantId, id);
      if (client) names.set(id, client.name);
    }
    return names;
  }

  /**
   * What changed about one person, whoever changed it (spec 8.2, user detail): for anyone who may
   * view users and reaches this one.
   */
  async history(
    tx: TenantTx,
    access: Access,
    userId: string,
    query: UserHistoryQuery,
  ): Promise<AuditListResult> {
    // Not found, or out of reach.
    await this.users.get(tx, access, userId);
    return this.page(
      tx,
      access.tenantId,
      [
        eq(auditLog.tenantId, access.tenantId),
        eq(auditLog.targetType, 'user'),
        eq(auditLog.targetId, userId),
      ],
      query,
    );
  }

  /** The people and API clients a page of entries names, by ID, for the audit viewer. */
  private async actorNames(
    tx: TenantTx,
    tenant: string,
    rows: readonly { actorKind: string; actorId: string | null }[],
  ): Promise<Map<string, string>> {
    const ids = (kind: string) =>
      rows.filter((row) => row.actorKind === kind && row.actorId).map((row) => row.actorId!);
    const names = new Map<string, string>();
    const people = ids('user');
    if (people.length > 0) {
      for (const [id, person] of await this.people.facts(tx, tenant, people)) {
        names.set(id, `${person.name} (${person.code})`);
      }
    }
    for (const id of new Set(ids('api_client'))) {
      const client = await this.clients.state(tx, tenant, id);
      if (client) names.set(id, client.name);
    }
    return names;
  }

  private async page(
    tx: TenantTx,
    tenantId: string,
    filters: (SQL | undefined)[],
    query: { limit: number; cursor?: string | undefined },
  ): Promise<AuditListResult> {
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
    const names = await this.actorNames(tx, tenantId, page);
    return {
      items: page.map((row): AuditEntry => ({
        id: row.id,
        actor: {
          kind: row.actorKind,
          id: row.actorId,
          // Named only when someone it names is found: a person, an API client.
          ...(row.actorId && names.has(row.actorId) ? { name: names.get(row.actorId)! } : {}),
        },
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
