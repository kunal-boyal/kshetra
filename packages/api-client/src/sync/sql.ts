/**
 * The little of SQLite the sync engine needs, so the same engine runs on expo-sqlite in the app
 * and on Node's built-in SQLite in tests.
 */
export type SqlValue = string | number | null;

export interface SqlExecutor {
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
}

export interface SqlDatabase extends SqlExecutor {
  /** Runs one or more statements that return nothing, such as a migration. */
  exec(sql: string): Promise<void>;
  /**
   * Runs `work` in one transaction, through `tx` only. Nothing else writes in the middle of it,
   * so a capture saved while a pull is applied can't be rolled back with the pull.
   */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}
