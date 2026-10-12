import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  type CreateTransferBody,
  newId,
  todayIn,
  type TransferResult,
  type UpdateUserBody,
} from '@kshetra/shared';
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { type TransferChanges, userTransfers } from '../../db/schema/iam';
import { AuditLog } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';
import { type Actor, auditActor, invalid, notFound, SYSTEM } from './actor';
import { UsersService } from './users.service';

type TransferRow = typeof userTransfers.$inferSelect;

/** How far ahead a transfer may be dated. */
const MAX_DAYS_AHEAD = 366;

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function toResult(row: TransferRow): TransferResult {
  return {
    id: row.id,
    userId: row.userId,
    effectiveDate: row.effectiveDate,
    changes: row.changes,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

/** Why a transfer failed on its day, in one line: the message, then each field's problem. */
function reasonOf(error: AppError): string {
  const details = (error.details ?? []).map((detail) => `${detail.path}: ${detail.issue}`);
  return [error.message, ...details].join(' ').slice(0, 1_000);
}

/**
 * Transfers (M3): a move to another manager, designation, role or territories from a date on. One
 * dated today applies as it is made, through the same rules as any change to a user. A later one
 * is checked now by those rules, waits as `scheduled`, and applies at 00:05 on the tenant's clock
 * on its day; if the rules refuse it then, it is marked `failed` with the reason, and nothing of
 * it applies.
 */
@Injectable()
export class TransfersService implements OnModuleInit {
  constructor(
    private readonly users: UsersService,
    private readonly territories: TerritoriesService,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
    private readonly database: Database,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
  ) {}

  onModuleInit(): void {
    this.queues.handle('maintenance', 'users.apply_transfers', (data) =>
      this.applyDue(String(data.tenantId), String(data.date)),
    );
    this.schedules.atTenantTime({
      name: 'transfers',
      at: '00:05',
      queue: 'maintenance',
      kind: 'users.apply_transfers',
    });
  }

  async create(
    tx: TenantTx,
    access: Access,
    userId: string,
    input: CreateTransferBody,
  ): Promise<TransferResult> {
    const tenantId = access.tenantId;
    // Not found, or out of the caller's reach.
    await this.users.get(tx, access, userId);
    const today = todayIn((await this.config.settings(tx, tenantId)).timezone);
    if (input.effectiveDate < today) throw invalid('effectiveDate', 'Choose today or a later day');
    if (input.effectiveDate > addDays(today, MAX_DAYS_AHEAD)) {
      throw invalid('effectiveDate', 'Choose a day within a year');
    }
    const changes: TransferChanges = {
      ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
      ...(input.designation !== undefined ? { designation: input.designation } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.territoryIds !== undefined ? { territoryIds: input.territoryIds } : {}),
    };
    const [row] = await tx
      .insert(userTransfers)
      .values({
        id: newId(),
        tenantId,
        userId,
        effectiveDate: input.effectiveDate,
        changes,
        createdBy: access.userId,
      })
      .returning();
    if (input.effectiveDate === today) return this.apply(tx, tenantId, row!, access);

    await this.users.checkMove(tx, tenantId, access, userId, changes);
    if (changes.territoryIds) {
      await this.territories.checkTerritories(tx, tenantId, changes.territoryIds);
    }
    const scheduled = toResult(row!);
    await this.audit.record(tx, tenantId, auditActor(access), {
      action: 'transfer.scheduled',
      target: { type: 'user', id: userId },
      after: scheduled,
    });
    return scheduled;
  }

  async list(tx: TenantTx, access: Access, userId: string): Promise<TransferResult[]> {
    await this.users.get(tx, access, userId);
    const rows = await tx
      .select()
      .from(userTransfers)
      .where(and(eq(userTransfers.tenantId, access.tenantId), eq(userTransfers.userId, userId)))
      .orderBy(desc(userTransfers.effectiveDate), desc(userTransfers.createdAt));
    return rows.map(toResult);
  }

  /** Withdraws a transfer that hasn't applied yet. */
  async cancel(
    tx: TenantTx,
    access: Access,
    userId: string,
    transferId: string,
  ): Promise<TransferResult> {
    await this.users.get(tx, access, userId);
    const [row] = await tx
      .select()
      .from(userTransfers)
      .where(
        and(
          eq(userTransfers.tenantId, access.tenantId),
          eq(userTransfers.userId, userId),
          eq(userTransfers.id, transferId),
        ),
      )
      .for('update');
    if (!row) throw notFound();
    if (row.status !== 'scheduled') {
      throw new AppError('CONFLICT', 'Only a transfer that is still to come can be cancelled.');
    }
    const [cancelled] = await tx
      .update(userTransfers)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: access.userId })
      .where(and(eq(userTransfers.tenantId, access.tenantId), eq(userTransfers.id, transferId)))
      .returning();
    const result = toResult(cancelled!);
    await this.audit.record(tx, access.tenantId, auditActor(access), {
      action: 'transfer.cancelled',
      target: { type: 'user', id: userId },
      before: toResult(row),
      after: result,
    });
    return result;
  }

  /**
   * Applies the scheduled transfers due by `date` (the tenant's), each in its own transaction, so
   * one that fails leaves the others alone. Running it again applies nothing twice.
   */
  async applyDue(tenantId: string, date: string): Promise<void> {
    const due = await this.database.forTenant(tenantId, (tx) =>
      tx
        .select({ id: userTransfers.id })
        .from(userTransfers)
        .where(
          and(
            eq(userTransfers.tenantId, tenantId),
            eq(userTransfers.status, 'scheduled'),
            lte(userTransfers.effectiveDate, date),
          ),
        )
        .orderBy(asc(userTransfers.effectiveDate), asc(userTransfers.createdAt)),
    );
    for (const { id } of due) {
      try {
        await this.database.forTenant(tenantId, async (tx) => {
          const [row] = await tx
            .select()
            .from(userTransfers)
            .where(
              and(
                eq(userTransfers.tenantId, tenantId),
                eq(userTransfers.id, id),
                eq(userTransfers.status, 'scheduled'),
              ),
            )
            .for('update');
          // Cancelled meanwhile.
          if (row) await this.apply(tx, tenantId, row, SYSTEM);
        });
      } catch (error) {
        // A refusal by the rules is the transfer's outcome; anything else fails the job, which
        // is retried.
        if (!(error instanceof AppError)) throw error;
        await this.database.forTenant(tenantId, (tx) => this.fail(tx, tenantId, id, error));
      }
    }
  }

  private async apply(
    tx: TenantTx,
    tenantId: string,
    row: TransferRow,
    actor: Actor,
  ): Promise<TransferResult> {
    const { territoryIds, ...move } = row.changes;
    if (Object.keys(move).length > 0) {
      await this.users.update(tx, tenantId, actor, row.userId, move as UpdateUserBody);
    }
    if (territoryIds) {
      await this.territories.replaceAttachments(
        tx,
        tenantId,
        row.userId,
        territoryIds,
        row.effectiveDate,
      );
    }
    const [applied] = await tx
      .update(userTransfers)
      .set({ status: 'applied', appliedAt: new Date() })
      .where(and(eq(userTransfers.tenantId, tenantId), eq(userTransfers.id, row.id)))
      .returning();
    const result = toResult(applied!);
    await this.audit.record(tx, tenantId, auditActor(actor), {
      action: 'transfer.applied',
      target: { type: 'user', id: row.userId },
      after: result,
    });
    return result;
  }

  private async fail(tx: TenantTx, tenantId: string, id: string, error: AppError): Promise<void> {
    const [failed] = await tx
      .update(userTransfers)
      .set({ status: 'failed', reason: reasonOf(error) })
      .where(
        and(
          eq(userTransfers.tenantId, tenantId),
          eq(userTransfers.id, id),
          eq(userTransfers.status, 'scheduled'),
        ),
      )
      .returning();
    if (!failed) return;
    await this.audit.record(tx, tenantId, auditActor(SYSTEM), {
      action: 'transfer.failed',
      target: { type: 'user', id: failed.userId },
      after: toResult(failed),
    });
  }
}
