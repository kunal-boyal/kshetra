import { Injectable } from '@nestjs/common';
import { AppError, issueAt, type LeaveType } from '@thelamp/shared';
import { and, asc, eq } from 'drizzle-orm';
import { leaveTypes } from '../../db/schema/leave';
import { type AuditActor, AuditLog } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

type Row = typeof leaveTypes.$inferSelect;

function toType(row: Row): LeaveType {
  return {
    key: row.key,
    name: row.name,
    paid: row.paid,
    annualQuota: Number(row.annualQuota),
    quotaYear: row.quotaYear as LeaveType['quotaYear'],
    halfDayAllowed: row.halfDayAllowed,
    ...(row.attachmentAfterDays !== null ? { attachmentAfterDays: row.attachmentAfterDays } : {}),
    active: row.active,
    accrual: row.accrual as LeaveType['accrual'],
    carryForwardMax: Number(row.carryForwardMax),
  };
}

const same = (a: LeaveType, b: LeaveType) =>
  JSON.stringify({ ...a, attachmentAfterDays: a.attachmentAfterDays ?? null }) ===
  JSON.stringify({ ...b, attachmentAfterDays: b.attachmentAfterDays ?? null });

/**
 * Leave types (M13, spec 5.10, decision D81): each tenant's types as configuration lists them,
 * keyed and never removed, since requests name them; a type no longer used is switched off.
 */
@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  async applyTemplate(
    tx: TenantTx,
    tenantId: string,
    types: readonly LeaveType[] | undefined,
  ): Promise<void> {
    if (!types || types.length === 0) return;
    await tx
      .insert(leaveTypes)
      .values(types.map((type, position) => this.values(tenantId, type, position)))
      .onConflictDoNothing();
  }

  async list(tx: TenantTx, tenantId: string): Promise<LeaveType[]> {
    const rows = await tx
      .select()
      .from(leaveTypes)
      .where(eq(leaveTypes.tenantId, tenantId))
      .orderBy(asc(leaveTypes.position), asc(leaveTypes.key));
    return rows.map(toType);
  }

  async find(tx: TenantTx, tenantId: string, key: string): Promise<LeaveType | null> {
    const [row] = await tx
      .select()
      .from(leaveTypes)
      .where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.key, key)));
    return row ? toType(row) : null;
  }

  /**
   * `PUT /v1/leave-types`: the whole list, in order. Every type already kept must stay in it;
   * says whether anything changed.
   */
  async replace(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    types: readonly LeaveType[],
  ): Promise<'same' | 'update'> {
    const before = await this.list(tx, tenantId);
    const sent = new Set(types.map((type) => type.key));
    const issues = [
      ...types.flatMap((type, index) =>
        types.findIndex((other) => other.key === type.key) !== index
          ? [issueAt(['items', index, 'key'], 'This key is in the list already')]
          : [],
      ),
      ...before.flatMap((type) =>
        sent.has(type.key)
          ? []
          : [issueAt(['items'], `Keep ${type.key}; switch it off instead of removing it`)],
      ),
    ];
    if (issues.length > 0) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', issues);
    }
    const changed =
      before.length !== types.length ||
      types.some((type, index) => !before[index] || !same(before[index], type));
    if (!changed) return 'same';
    for (const [position, type] of types.entries()) {
      const values = this.values(tenantId, type, position);
      await tx
        .insert(leaveTypes)
        .values(values)
        .onConflictDoUpdate({
          target: [leaveTypes.tenantId, leaveTypes.key],
          set: { ...values, updatedAt: new Date() },
        });
    }
    await this.config.touch(tx, tenantId, actor.kind === 'user' ? actor.id : null);
    await this.audit.record(tx, tenantId, actor, {
      action: 'leave_types.changed',
      target: { type: 'leave_types', id: null },
      before: { items: before },
      after: { items: types },
    });
    return 'update';
  }

  private values(tenantId: string, type: LeaveType, position: number) {
    return {
      tenantId,
      key: type.key,
      name: type.name,
      paid: type.paid,
      annualQuota: String(type.annualQuota),
      quotaYear: type.quotaYear,
      halfDayAllowed: type.halfDayAllowed,
      attachmentAfterDays: type.attachmentAfterDays ?? null,
      active: type.active,
      accrual: type.accrual,
      carryForwardMax: String(type.carryForwardMax),
      position,
    };
  }
}
