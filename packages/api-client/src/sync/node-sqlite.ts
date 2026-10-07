/// <reference types="node" />
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlDatabase, SqlExecutor } from './sql';

/**
 * The sync engine's database on Node's built-in SQLite, for tests and the simulated device of the
 * API's integration tests. Transactions run one after another, as the app's do.
 */
export function nodeSqlite(path = ':memory:'): SqlDatabase {
  const db = new DatabaseSync(path);
  let queue: Promise<unknown> = Promise.resolve();
  const values = (params: readonly (string | number | null)[] = []) =>
    params as readonly SQLInputValue[];
  const executor: SqlExecutor = {
    async run(sql, params) {
      db.prepare(sql).run(...values(params));
    },
    async all<T>(sql: string, params?: readonly (string | number | null)[]) {
      return db.prepare(sql).all(...values(params)) as T[];
    },
    async get<T>(sql: string, params?: readonly (string | number | null)[]) {
      return (db.prepare(sql).get(...values(params)) as T | undefined) ?? null;
    },
  };
  return {
    ...executor,
    async exec(sql) {
      db.exec(sql);
    },
    transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const next = queue.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await work(executor);
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
