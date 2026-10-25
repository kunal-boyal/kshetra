import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type AuditAction, type AuditActorKind, newId } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import { auditLog } from '../db/audit-log';
import type { Access } from './auth';
import { Database, type TenantTx } from './database';

/** Who made a change, and from where. */
export interface AuditActor {
  kind: AuditActorKind;
  id: string | null;
  ip?: string | null;
  deviceId?: string | null;
  /** The grant vendor staff acted under (spec M21, decision D93). */
  supportGrantId?: string | null;
}

/** Changes the system makes itself, such as provisioning a tenant. */
export const SYSTEM_ACTOR: AuditActor = { kind: 'system', id: null };

/**
 * A signed-in user, with the address and device of their request; or vendor support, marked with
 * the grant it acted under.
 */
export function userActor(access: Access): AuditActor {
  if (access.support) {
    return {
      kind: 'platform',
      id: access.userId,
      ip: access.ip,
      deviceId: null,
      supportGrantId: access.support.grantId,
    };
  }
  return { kind: 'user', id: access.userId, ip: access.ip, deviceId: access.deviceId ?? null };
}

export interface AuditRecord {
  action: AuditAction;
  target: { type: string; id: string | null };
  before?: unknown;
  after?: unknown;
}

/**
 * The audit log (module M21). Entries are written in the same transaction as the change they
 * record, so a change and its entry commit or roll back together. The application can only add
 * and read entries; retention drops whole months (D9).
 */
@Injectable()
export class AuditLog implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuditLog.name);

  constructor(private readonly database: Database) {}

  /** Makes sure this month's partition exists before the first entry needs it. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.database.db.execute(sql`select cell.ensure_audit_log_partitions()`);
    } catch (error) {
      this.logger.warn(`Could not check the audit log's partitions: ${(error as Error).message}`);
    }
  }

  async record(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    entry: AuditRecord,
  ): Promise<void> {
    await tx.insert(auditLog).values({
      id: newId(),
      tenantId,
      actorKind: actor.kind,
      actorId: actor.id,
      action: entry.action,
      targetType: entry.target.type,
      targetId: entry.target.id,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: actor.ip ?? null,
      deviceId: actor.deviceId ?? null,
      supportGrantId: actor.supportGrantId ?? null,
    });
  }
}
