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

  /** People active now. */
  async active(tx: TenantTx, tenantId: string): Promise<number> {
    const [row] = await tx
      .select({ active: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.status, 'active')));
    return row?.active ?? 0;
  }

  /** Seats in use against the plan's limit, for the people list; null without a limit (D104). */
  async usage(tx: TenantTx, tenantId: string): Promise<{ used: number; limit: number } | null> {
    const { limits } = await this.entitlements.forTenant(tenantId);
    if (limits.users === null) return null;
    return { used: await this.active(tx, tenantId), limit: limits.users };
  }

  /**
   * Refuses one more active person past the plan's limit (SEAT_LIMIT). The tenant's seats are
   * counted one change at a time, so two people made active together can't both take the last
   * seat (ASVS V2.3.4, decision D101); the lock holds until the change commits.
   */
  async assertRoom(tx: TenantTx, tenantId: string): Promise<void> {
    const { limits } = await this.entitlements.forTenant(tenantId);
    if (limits.users === null) return;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`seats:${tenantId}`}, 0))`,
    );
    if ((await this.active(tx, tenantId)) >= limits.users) {
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
