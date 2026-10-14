import type { SqlDatabase, SqlExecutor } from './sql';

/** A visit with nothing recorded for this long has ended; the server checks it out too (M6). */
export const VISIT_IDLE_MS = 4 * 3_600_000;

/** The phone's open visit (M6). */
export interface VisitState {
  owner: string;
  visitId: string;
  accountId: string;
  shiftId: string;
  checkedInAt: number;
  /** The check-in or the latest submission made in the visit. */
  lastActivityAt: number;
}

interface VisitRecord {
  owner: string;
  visit_id: string;
  account_id: string;
  shift_id: string;
  checked_in_at: number;
  last_activity_at: number;
}

const toState = (record: VisitRecord): VisitState => ({
  owner: record.owner,
  visitId: record.visit_id,
  accountId: record.account_id,
  shiftId: record.shift_id,
  checkedInAt: record.checked_in_at,
  lastActivityAt: record.last_activity_at,
});

/**
 * Visits on the phone (M6): the person's open visit, opened at check-in and closed at check-out,
 * at the next check-in or at punch-out, in the transaction that queues the record. One left idle
 * for 4 hours reads as ended, as the server will have checked it out.
 */
export class Visits {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Opens a visit, replacing any still open: the server checks that one out at this check-in. */
  async open(tx: SqlExecutor, state: Omit<VisitState, 'lastActivityAt'>): Promise<void> {
    await tx.run(
      `INSERT OR REPLACE INTO visit_state
         (owner, visit_id, account_id, shift_id, checked_in_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        state.owner,
        state.visitId,
        state.accountId,
        state.shiftId,
        state.checkedInAt,
        state.checkedInAt,
      ],
    );
  }

  /** The person's open visit, or null; one idle for 4 hours is closed on the way. */
  async current(owner: string, db: SqlExecutor = this.db): Promise<VisitState | null> {
    const record = await db.get<VisitRecord>('SELECT * FROM visit_state WHERE owner = ?', [owner]);
    if (!record) return null;
    if (record.last_activity_at + VISIT_IDLE_MS < this.clock()) {
      await db.run('DELETE FROM visit_state WHERE owner = ? AND visit_id = ?', [
        owner,
        record.visit_id,
      ]);
      return null;
    }
    return toState(record);
  }

  /** Something was recorded in the visit at `at`. */
  async touch(tx: SqlExecutor, owner: string, visitId: string, at: number): Promise<void> {
    await tx.run(
      `UPDATE visit_state SET last_activity_at = max(last_activity_at, ?)
        WHERE owner = ? AND visit_id = ?`,
      [at, owner, visitId],
    );
  }

  async close(tx: SqlExecutor, owner: string): Promise<void> {
    await tx.run('DELETE FROM visit_state WHERE owner = ?', [owner]);
  }
}
