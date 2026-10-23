import type { SqlDatabase, SqlExecutor, SqlValue } from '@thelamp/api-client/sync';
import Constants from 'expo-constants';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

/** How long a write waits for another connection's transaction before it gives up. */
const BUSY_TIMEOUT_MS = 5_000;

function executor(db: SQLite.SQLiteDatabase): SqlExecutor {
  const bind = (params: readonly SqlValue[] = []) => params as SQLite.SQLiteBindValue[];
  return {
    async run(sql, params) {
      await db.runAsync(sql, bind(params));
    },
    all: <T>(sql: string, params?: readonly SqlValue[]) => db.getAllAsync<T>(sql, bind(params)),
    get: <T>(sql: string, params?: readonly SqlValue[]) => db.getFirstAsync<T>(sql, bind(params)),
  };
}

/**
 * The phone's own database (spec 11.3), in the app's private storage. A sync applies its pages in
 * exclusive transactions on a connection of their own, so a capture saved meanwhile waits for the
 * lock instead of joining the sync's transaction. The web preview has no second connection.
 */
export async function openLocalDatabase(): Promise<SqlDatabase> {
  const db = await SQLite.openDatabaseAsync(`${Constants.expoConfig?.slug ?? 'thelamp'}.db`);
  await db.execAsync(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return {
    ...executor(db),
    exec: (sql) => db.execAsync(sql),
    async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      let result: T | undefined;
      if (Platform.OS === 'web') {
        await db.withTransactionAsync(async () => {
          result = await work(executor(db));
        });
      } else {
        await db.withExclusiveTransactionAsync(async (txn) => {
          await txn.execAsync(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
          result = await work(executor(txn));
        });
      }
      return result as T;
    },
  };
}
