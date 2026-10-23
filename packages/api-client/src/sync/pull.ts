import { SYNC_ENTITIES, type SyncEntity, type SyncPullResult } from '@thelamp/shared';
import { ApiError } from '../client';
import { LOCAL_ENTITIES, type LocalEntity } from './local-schema';
import type { SqlDatabase, SqlExecutor } from './sql';

/** What the pull needs of the API client. */
export interface PullClient {
  syncPull(entities: readonly SyncEntity[], cursor?: string): Promise<SyncPullResult>;
}

/** Keys of `sync_state`. */
const OWNER = 'owner';
const CURSOR = 'cursor';
const PULLED_AT = 'pulled_at';
const FULL_REFRESH_AT = 'full_refresh_at';
const generationKey = (entity: SyncEntity) => `generation.${entity}`;

export async function readState(db: SqlExecutor, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key]);
  return row?.value ?? null;
}

async function writeState(db: SqlExecutor, key: string, value: string | null): Promise<void> {
  if (value === null) await db.run('DELETE FROM sync_state WHERE key = ?', [key]);
  else {
    await db.run(
      'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }
}

/** When the last pull finished, in milliseconds since the epoch, or null before the first. */
export async function lastPulledAt(db: SqlExecutor): Promise<number | null> {
  const value = await readState(db, PULLED_AT);
  return value === null ? null : Number(value);
}

/**
 * Forgets the reference data and the cursor, and keeps the outbox: on sign-out, and before
 * someone else's data comes onto the phone (spec 11.3).
 */
export async function clearReferenceData(db: SqlDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    for (const name of SYNC_ENTITIES) await tx.run(`DELETE FROM ${LOCAL_ENTITIES[name].table}`);
    await tx.run('DELETE FROM sync_state');
  });
}

/**
 * Makes the phone's data `owner`'s (`tenant:user`). Someone else's reference data, cursor and
 * cache are cleared first, so nobody sees what the last person signed in kept (spec 11.3).
 */
export async function claim(db: SqlDatabase, owner: string): Promise<void> {
  if ((await readState(db, OWNER)) === owner) return;
  await clearReferenceData(db);
  await writeState(db, OWNER, owner);
}

const cacheKey = (key: string) => `cache.${key}`;

/** What the app kept of a response for offline starts, such as the config bundle, if `owner`'s. */
export async function readCache<T>(db: SqlDatabase, owner: string, key: string): Promise<T | null> {
  if ((await readState(db, OWNER)) !== owner) return null;
  const value = await readState(db, cacheKey(key));
  return value === null ? null : (JSON.parse(value) as T);
}

export async function writeCache(
  db: SqlDatabase,
  owner: string,
  key: string,
  value: unknown,
): Promise<void> {
  await claim(db, owner);
  await writeState(db, cacheKey(key), JSON.stringify(value));
}

/**
 * Applies one page in one local transaction, with the cursor that follows it, so a phone that
 * stops halfway resumes from the last page it kept. A full pass gives the entity a new generation
 * and, on its last page, drops the rows of older generations: what the server no longer sends.
 */
export async function applyPage(db: SqlDatabase, page: SyncPullResult, now: number): Promise<void> {
  await db.transaction(async (tx) => {
    for (const name of SYNC_ENTITIES) {
      const changes = page.entities[name];
      if (!changes) continue;
      const entity = LOCAL_ENTITIES[name] as LocalEntity<unknown>;
      let generation = Number((await readState(tx, generationKey(name))) ?? '0');
      if (changes.pass === 'full' && changes.first) {
        generation += 1;
        await writeState(tx, generationKey(name), String(generation));
      }
      for (const id of changes.removed) {
        await tx.run(`DELETE FROM ${entity.table} WHERE id = ?`, [id]);
      }
      for (const row of changes.rows) {
        const columns = { ...entity.columns(row), sync_gen: generation };
        const names = Object.keys(columns);
        await tx.run(
          `INSERT INTO ${entity.table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})
           ON CONFLICT (id) DO UPDATE SET ${names
             .filter((column) => column !== 'id')
             .map((column) => `${column} = excluded.${column}`)
             .join(', ')}`,
          Object.values(columns),
        );
      }
      if (changes.pass === 'full' && changes.done) {
        await tx.run(`DELETE FROM ${entity.table} WHERE sync_gen < ?`, [generation]);
      }
    }
    await writeState(tx, CURSOR, page.cursor);
    if (!page.more) await writeState(tx, PULLED_AT, String(now));
  });
}

/**
 * Pulls until the server has nothing more (spec 11.3). Reference data belongs to whoever signed
 * in: when `owner` (tenant and user) differs from the data's, it is cleared first. `SYNC_RESET`
 * drops the cursor and pulls from the start; full passes then replace each entity's rows.
 */
export async function pull(
  db: SqlDatabase,
  client: PullClient,
  entities: readonly SyncEntity[],
  owner: string,
  clock: () => number = Date.now,
): Promise<void> {
  await claim(db, owner);
  let cursor = await readState(db, CURSOR);
  let fresh = cursor === null;
  let reset = false;
  for (;;) {
    let page: SyncPullResult;
    try {
      page = await client.syncPull(entities, cursor ?? undefined);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SYNC_RESET' && !reset) {
        reset = true;
        fresh = true;
        cursor = null;
        await writeState(db, CURSOR, null);
        continue;
      }
      throw error;
    }
    await applyPage(db, page, clock());
    cursor = page.cursor;
    if (!page.more) break;
  }
  if (fresh) await writeState(db, FULL_REFRESH_AT, String(clock()));
}
