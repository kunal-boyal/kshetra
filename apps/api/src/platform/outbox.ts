import { Injectable, Logger } from '@nestjs/common';
import { EVENT_PAYLOADS, type EventPayload, type EventType, newId } from '@thelamp/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { outboxEvents } from '../db/schema/platform';
import { Database, type TenantTx } from './database';

/** An event as consumers receive it. */
export interface OutboxEvent<T extends EventType = EventType> {
  id: string;
  tenantId: string;
  type: T;
  aggregateId: string;
  payload: EventPayload<T>;
  createdAt: Date;
}

/**
 * Takes one event. It runs inside the delivery's transaction, in the event's tenant, and must be
 * idempotent: delivery is at least once, so it may see the same event again.
 */
export type Consumer = (event: OutboxEvent, tx: TenantTx) => Promise<void>;

/** The wait before retrying an event: 5 s doubling to at most 15 minutes, as the app's outbox does. */
export function retryDelayMs(attempts: number): number {
  return Math.min(15 * 60_000, 5_000 * 2 ** attempts);
}

/**
 * Domain events (spec 12.4). `publish` adds an event in the caller's transaction and delivers it
 * as soon as that commits; anything that fails stays in the outbox for the relay to retry.
 */
@Injectable()
export class Outbox {
  private readonly logger = new Logger(Outbox.name);
  private readonly consumers = new Map<EventType, { name: string; take: Consumer }[]>();

  constructor(private readonly database: Database) {}

  /** Registers a consumer, by name, for events of these types. */
  consume(types: readonly EventType[], name: string, take: Consumer): void {
    for (const type of types) {
      const list = this.consumers.get(type) ?? [];
      list.push({ name, take });
      this.consumers.set(type, list);
    }
  }

  async publish<T extends EventType>(
    tx: TenantTx,
    tenantId: string,
    type: T,
    aggregateId: string,
    payload: EventPayload<T>,
  ): Promise<void> {
    const id = newId();
    await tx.insert(outboxEvents).values({
      id,
      tenantId,
      type,
      aggregateId,
      payload: EVENT_PAYLOADS[type].parse(payload),
    });
    this.database.afterCommit(tx, async () => {
      await this.deliver(tenantId, id);
    });
  }

  /** How many of a tenant's events wait to be delivered, as a tenant about to move must have none. */
  async waiting(tx: TenantTx, tenantId: string): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.tenantId, tenantId), isNull(outboxEvents.dispatchedAt)));
    return row?.count ?? 0;
  }

  /**
   * Hands one event to its consumers, unless it is done or another process holds it. Each
   * consumer runs in a savepoint, so a failing one leaves nothing half done. Returns true when
   * every consumer took the event.
   */
  async deliver(tenantId: string, id: string): Promise<boolean> {
    return this.database.forTenant(tenantId, async (tx) => {
      const where = and(
        eq(outboxEvents.tenantId, tenantId),
        eq(outboxEvents.id, id),
        isNull(outboxEvents.dispatchedAt),
      );
      const [row] = await tx.select().from(outboxEvents).where(where).for('update', {
        skipLocked: true,
      });
      if (!row) return false;
      const event = {
        id: row.id,
        tenantId: row.tenantId,
        type: row.type as EventType,
        aggregateId: row.aggregateId,
        payload: row.payload as EventPayload<EventType>,
        createdAt: row.createdAt,
      };
      for (const consumer of this.consumers.get(event.type) ?? []) {
        await tx.execute(sql`savepoint consumer`);
        try {
          await consumer.take(event, tx);
          await tx.execute(sql`release savepoint consumer`);
        } catch (error) {
          await tx.execute(sql`rollback to savepoint consumer`);
          const attempts = row.attempts + 1;
          const message = `${consumer.name}: ${(error as Error).message}`.slice(0, 1_000);
          this.logger.warn(`Event ${event.type} ${id} failed, attempt ${attempts}: ${message}`);
          await tx
            .update(outboxEvents)
            .set({
              attempts,
              lastError: message,
              nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
            })
            .where(where);
          return false;
        }
      }
      await tx
        .update(outboxEvents)
        .set({ attempts: row.attempts + 1, lastError: null, dispatchedAt: new Date() })
        .where(where);
      return true;
    });
  }
}
