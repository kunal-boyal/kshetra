import { Injectable } from '@nestjs/common';
import { AppError } from '@thelamp/shared';
import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { seatIntervals, users } from '../../db/schema/iam';
import type { TenantTx } from '../../platform/database';
import { Entitlements } from '../../platform/planes';

/**
 * Seats (BR-45, decision D89): each person's active stretches, opened and closed in the
 * transaction that changes their status, and the plan's cap on people active at once.
 */
@Injectable()
export class Seats {
  constructor(private readonly entitlements: Entitlements) {}

  /** Refuses one more active person past the plan's limit (SEAT_LIMIT). */
  async assertRoom(tx: TenantTx, tenantId: string): Promise<void> {
    const { limits } = await this.entitlements.forTenant(tenantId);
    if (limits.users === null) return;
    const [row] = await tx
      .select({ active: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.status, 'active')));
    if ((row?.active ?? 0) >= limits.users) {
      throw new AppError(
        'SEAT_LIMIT',
        `Your plan allows ${limits.users} active people. Deactivate someone or add seats.`,
      );
    }
  }

  async open(tx: TenantTx, tenantId: string, userId: string, at = new Date()): Promise<void> {
    await tx
      .insert(seatIntervals)
      .values({ tenantId, userId, activeFrom: at })
      .onConflictDoNothing();
  }

  async close(tx: TenantTx, tenantId: string, userId: string, at = new Date()): Promise<void> {
    await tx
      .update(seatIntervals)
      .set({ activeTo: at })
      .where(
        and(
          eq(seatIntervals.tenantId, tenantId),
          eq(seatIntervals.userId, userId),
          isNull(seatIntervals.activeTo),
        ),
      );
  }

  /** Every stretch that touches `from` to `to`. */
  async during(tx: TenantTx, tenantId: string, from: Date, to: Date) {
    return tx
      .select({
        userId: seatIntervals.userId,
        activeFrom: seatIntervals.activeFrom,
        activeTo: seatIntervals.activeTo,
      })
      .from(seatIntervals)
      .where(
        and(
          eq(seatIntervals.tenantId, tenantId),
          lte(seatIntervals.activeFrom, to),
          or(isNull(seatIntervals.activeTo), gte(seatIntervals.activeTo, from)),
        ),
      );
  }
}
