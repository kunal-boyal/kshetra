import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  SYNC_ENTITIES,
  type SyncEntity,
  type SyncPullQuery,
  type SyncPullResult,
} from '@thelamp/shared';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import { syncTombstones } from '../../db/schema/sync';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { CONFIG } from '../../platform/tokens';
import {
  CURSOR_FORMAT,
  type CursorState,
  decodeCursor,
  encodeCursor,
  type EntityState,
  type PassState,
} from './cursor';
import { type SyncRow, SyncEntities } from './sync-entities';

/** A copy older than this takes a full pass, as tombstones it needs may be purged at 35 days. */
const MAX_COPY_AGE_SECONDS = 28 * 86_400;

const syncReset = () =>
  new AppError('SYNC_RESET', 'This sync cursor can no longer be used. Start a full sync.');

interface Moment {
  /** The oldest transaction still running: everything older is committed or gone for good. */
  horizon: number;
  /** Seconds since the epoch. */
  now: number;
  limit: number;
}

/** A row to keep or an ID to drop, in the order pages are cut. */
interface Item {
  version: number;
  id: string;
  row?: unknown;
}

function byVersionThenId(a: Item, b: Item): number {
  if (a.version !== b.version) return a.version - b.version;
  // At one version a tombstone sorts before a row, so the row is what stays.
  if (a.id === b.id) return a.row === undefined ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * Pulls for the mobile sync (spec 11.3, decision D40). Each entity moves through passes: a full
 * pass sends every row the caller may hold, after which the phone drops whatever it did not
 * receive; a changes pass sends the rows and tombstones written since the copy's horizon. A pass
 * may span pages, at most `limit` items each, in (row version, ID) order. A copy's horizon is the
 * oldest transaction that was running when its pass began, so a slow transaction that commits
 * later is still picked up by the next pass.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly entities: SyncEntities,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** One page per requested entity. Run it in one read-only `repeatable read` transaction. */
  async pull(tx: TenantTx, access: Access, query: SyncPullQuery): Promise<SyncPullResult> {
    const {
      rows: [snapshot],
    } = await tx.execute<{ xmin: string; xmax: string }>(
      sql`select pg_snapshot_xmin(pg_current_snapshot())::text as xmin,
                 pg_snapshot_xmax(pg_current_snapshot())::text as xmax`,
    );
    const at: Moment = {
      horizon: Number(snapshot!.xmin),
      now: Math.floor(Date.now() / 1_000),
      limit: query.limit,
    };
    const cursor = query.cursor
      ? this.read(query.cursor, access, Number(snapshot!.xmax))
      : this.start(access);
    const entities: Record<string, unknown> = {};
    let more = false;
    for (const name of SYNC_ENTITIES.filter((entity) => query.entities.includes(entity))) {
      const { page, state } = await this.page(tx, access, name, cursor.entities[name], at);
      entities[name] = page;
      cursor.entities[name] = state;
      if (!page.done) more = true;
    }
    return {
      entities: entities as SyncPullResult['entities'],
      cursor: encodeCursor(cursor),
      more,
    };
  }

  private start(access: Access): CursorState {
    return {
      format: CURSOR_FORMAT,
      tenantId: access.tenantId,
      userId: access.userId,
      epoch: this.config.SYNC_EPOCH,
      entities: {},
    };
  }

  /**
   * The caller's cursor. One that can't be read, belongs to someone else or another epoch, or
   * names transactions that haven't happened (the database was restored) starts over.
   */
  private read(raw: string, access: Access, newest: number): CursorState {
    const cursor = decodeCursor(raw);
    if (
      !cursor ||
      cursor.tenantId !== access.tenantId ||
      cursor.userId !== access.userId ||
      cursor.epoch !== this.config.SYNC_EPOCH
    ) {
      throw syncReset();
    }
    for (const state of Object.values(cursor.entities)) {
      if (state.since > newest || (state.pass && state.pass.next > newest)) throw syncReset();
    }
    return cursor;
  }

  private async page(
    tx: TenantTx,
    access: Access,
    name: SyncEntity,
    state: EntityState | undefined,
    at: Moment,
  ) {
    const source = this.entities.get(name);
    const scope = await source.scope(tx, access);
    let pass: PassState;
    let first = true;
    if (
      !state ||
      state.version !== source.version ||
      state.scope !== scope ||
      (!state.pass && at.now - state.sinceAt > MAX_COPY_AGE_SECONDS)
    ) {
      pass = { mode: 'full', since: 0, next: at.horizon, nextAt: at.now, after: null };
    } else if (!state.pass) {
      pass = {
        mode: 'changes',
        since: state.since,
        next: at.horizon,
        nextAt: at.now,
        after: null,
      };
    } else {
      pass = state.pass;
      first = false;
    }

    // One more than a page of each, to know whether anything is left after it.
    const fetch = at.limit + 1;
    const rows: SyncRow[] = await source.rows(tx, access, {
      since: pass.since,
      after: pass.after,
      limit: fetch,
    });
    const removed =
      pass.mode === 'changes' ? await this.tombstones(tx, access.tenantId, name, pass, fetch) : [];
    const items: Item[] = [...rows, ...removed].sort(byVersionThenId);
    const done = items.length <= at.limit;
    const sent = items.slice(0, at.limit);

    // An ID the page names twice keeps its latest item.
    const latest = new Map<string, Item>();
    for (const item of sent) latest.set(item.id, item);
    const page = {
      pass: pass.mode,
      first,
      done,
      rows: [...latest.values()].filter((item) => item.row !== undefined).map((item) => item.row),
      removed: [...latest.values()].filter((item) => item.row === undefined).map((item) => item.id),
    };

    const last = sent.at(-1);
    const next: EntityState =
      done || !last
        ? {
            version: source.version,
            scope,
            since: pass.next,
            sinceAt: pass.nextAt,
            pass: null,
          }
        : {
            version: source.version,
            scope,
            since: state?.since ?? 0,
            sinceAt: state?.sinceAt ?? at.now,
            pass: { ...pass, after: [last.version, last.id] },
          };
    return { page, state: next };
  }

  private async tombstones(
    tx: TenantTx,
    tenantId: string,
    entity: SyncEntity,
    pass: PassState,
    limit: number,
  ): Promise<Item[]> {
    return tx
      .select({ version: syncTombstones.rowVersion, id: syncTombstones.entityId })
      .from(syncTombstones)
      .where(
        and(
          eq(syncTombstones.tenantId, tenantId),
          eq(syncTombstones.entity, entity),
          gte(syncTombstones.rowVersion, pass.since),
          pass.after
            ? sql`(${syncTombstones.rowVersion}, ${syncTombstones.entityId}) > (${pass.after[0]}::bigint, ${pass.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(syncTombstones.rowVersion), asc(syncTombstones.entityId))
      .limit(limit);
  }
}
