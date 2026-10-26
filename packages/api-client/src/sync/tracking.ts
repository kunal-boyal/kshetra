import type { LocationBatchResult, LocationPointBody } from '@thelamp/shared';
import { SHIFT_FIX_ACCURACY_M } from '@thelamp/shared';
import type { SqlDatabase, SqlExecutor } from './sql';

/**
 * Tracking on the phone (M5, spec 12.1): the person's open shift as the background task reads
 * it, and the points waiting to upload. The task keeps only what the server would accept: points
 * on an open, unpaused shift, before its longest length, real, and close enough.
 */

/** The phone's open shift. */
export interface ShiftState {
  owner: string;
  shiftId: string;
  startedAt: number;
  /** The shift's longest end; no point is kept after it (BR-37). */
  endsBy: number;
  /** Seconds between points, the tenant's interval. */
  intervalSeconds: number;
  /** The open pause's ID, or null while tracking runs. */
  pauseId: string | null;
}

/** A point as the operating system hands it to the task. */
export interface RawPoint {
  id: string;
  capturedAt: number;
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  mocked: boolean;
  battery: number | null;
  source: 'foreground' | 'background';
}

interface StateRecord {
  owner: string;
  shift_id: string;
  started_at: number;
  ends_by: number;
  interval_s: number;
  pause_id: string | null;
}

interface PointRecord {
  id: string;
  shift_id: string;
  captured_at: number;
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  mocked: number;
  source: 'foreground' | 'background';
  battery: number | null;
}

const toState = (record: StateRecord): ShiftState => ({
  owner: record.owner,
  shiftId: record.shift_id,
  startedAt: record.started_at,
  endsBy: record.ends_by,
  intervalSeconds: record.interval_s,
  pauseId: record.pause_id,
});

/** A shift's odometer readings as the phone keeps them (decision D99). */
export interface ShiftOdometer {
  shiftId: string;
  /** The punch-in's day on the tenant's clock. */
  date: string;
  open: string | null;
  close: string | null;
  /** The punch-out's upload, which a claim from these readings waits for. */
  closeUploadId: string | null;
}

interface OdometerRecord {
  shift_id: string;
  date: string;
  open_reading: string | null;
  close_reading: string | null;
  close_upload_id: string | null;
}

const toOdometer = (record: OdometerRecord): ShiftOdometer => ({
  shiftId: record.shift_id,
  date: record.date,
  open: record.open_reading,
  close: record.close_reading,
  closeUploadId: record.close_upload_id,
});

/** Readings older than this go, as no claim starts from them any more. */
const ODOMETER_KEEP_DAYS = 62;

/** At most this many points go in one upload (spec 12.1). */
export const FLUSH_LIMIT = 200;

/** Why a point was dropped on the phone rather than kept. */
export type DropReason = 'NO_SHIFT' | 'PAUSED' | 'PAST_LONGEST' | 'MOCKED' | 'INACCURATE';

export class Tracking {
  constructor(private readonly db: SqlDatabase) {}

  /** Opens the person's shift on the phone, in the transaction that queues the punch-in. */
  async open(tx: SqlExecutor, state: Omit<ShiftState, 'pauseId'>): Promise<void> {
    await tx.run(
      `INSERT OR REPLACE INTO shift_state (owner, shift_id, started_at, ends_by, interval_s, pause_id)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      [state.owner, state.shiftId, state.startedAt, state.endsBy, state.intervalSeconds],
    );
  }

  /** The person's open shift, or null. */
  async current(owner: string, db: SqlExecutor = this.db): Promise<ShiftState | null> {
    const record = await db.get<StateRecord>('SELECT * FROM shift_state WHERE owner = ?', [owner]);
    return record ? toState(record) : null;
  }

  /** Every open shift on the phone; the task records for whoever is on duty. */
  async openShifts(): Promise<ShiftState[]> {
    return (await this.db.all<StateRecord>('SELECT * FROM shift_state')).map(toState);
  }

  async pause(tx: SqlExecutor, owner: string, pauseId: string | null): Promise<void> {
    await tx.run('UPDATE shift_state SET pause_id = ? WHERE owner = ?', [pauseId, owner]);
  }

  /** Closes the shift on the phone; its points stay until they upload. */
  async close(tx: SqlExecutor, owner: string): Promise<void> {
    await tx.run('DELETE FROM shift_state WHERE owner = ?', [owner]);
  }

  /** Keeps the opening reading of a shift punched in on the phone, with the shift's day. */
  async openOdometer(
    tx: SqlExecutor,
    owner: string,
    shift: { shiftId: string; date: string; reading: string | null },
  ): Promise<void> {
    await tx.run(
      `INSERT OR REPLACE INTO shift_odometer (owner, shift_id, date, open_reading, close_reading, close_upload_id)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      [owner, shift.shiftId, shift.date, shift.reading],
    );
    const before = new Date(Date.parse(`${shift.date}T00:00:00Z`) - ODOMETER_KEEP_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await tx.run('DELETE FROM shift_odometer WHERE owner = ? AND date < ?', [owner, before]);
  }

  /** Keeps the closing reading, and the punch-out's upload that carries it. */
  async closeOdometer(
    tx: SqlExecutor,
    owner: string,
    shiftId: string,
    reading: string | null,
    uploadId: string,
  ): Promise<void> {
    await tx.run(
      'UPDATE shift_odometer SET close_reading = ?, close_upload_id = ? WHERE owner = ? AND shift_id = ?',
      [reading, uploadId, owner, shiftId],
    );
  }

  /** A shift's readings, or null when the phone kept none. */
  async odometer(owner: string, shiftId: string): Promise<ShiftOdometer | null> {
    const record = await this.db.get<OdometerRecord>(
      'SELECT * FROM shift_odometer WHERE owner = ? AND shift_id = ?',
      [owner, shiftId],
    );
    return record ? toOdometer(record) : null;
  }

  /** The day's shifts with both readings in, latest first, for a fuel claim. */
  async odometersOn(owner: string, date: string): Promise<ShiftOdometer[]> {
    const records = await this.db.all<OdometerRecord>(
      `SELECT * FROM shift_odometer
        WHERE owner = ? AND date = ? AND open_reading IS NOT NULL AND close_reading IS NOT NULL
        ORDER BY rowid DESC`,
      [owner, date],
    );
    return records.map(toOdometer);
  }

  /**
   * Keeps what the server would accept and drops the rest (spec 12.1): no open shift, paused,
   * past the shift's longest end, mocked, or further out than 250 m. Returns what each point did.
   */
  async record(
    owner: string,
    points: readonly RawPoint[],
  ): Promise<{ kept: number; dropped: Partial<Record<DropReason, number>> }> {
    const dropped: Partial<Record<DropReason, number>> = {};
    const drop = (reason: DropReason) => {
      dropped[reason] = (dropped[reason] ?? 0) + 1;
    };
    let kept = 0;
    await this.db.transaction(async (tx) => {
      const state = await this.current(owner, tx);
      for (const point of points) {
        if (!state) drop('NO_SHIFT');
        else if (state.pauseId) drop('PAUSED');
        else if (point.capturedAt > state.endsBy) drop('PAST_LONGEST');
        else if (point.mocked) drop('MOCKED');
        else if (!(point.accuracy <= SHIFT_FIX_ACCURACY_M)) drop('INACCURATE');
        else {
          await tx.run(
            `INSERT OR IGNORE INTO location_buffer
               (id, owner, shift_id, captured_at, lat, lng, accuracy, speed, mocked, source, battery)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            [
              point.id,
              owner,
              state.shiftId,
              point.capturedAt,
              point.lat,
              point.lng,
              point.accuracy,
              point.speed,
              point.source,
              point.battery,
            ],
          );
          kept += 1;
        }
      }
    });
    return { kept, dropped };
  }

  /** Points waiting to upload. */
  async waiting(owner: string): Promise<number> {
    const row = await this.db.get<{ n: number }>(
      'SELECT count(*) AS n FROM location_buffer WHERE owner = ?',
      [owner],
    );
    return row?.n ?? 0;
  }

  /**
   * Uploads waiting points, oldest first, up to 200 a request, for shifts the server knows:
   * a point sent before its punch-in would be refused for good. Accepted and refused points both
   * leave the buffer, as the server's answer is final (spec 12.1); a failed request leaves them.
   */
  async flush(
    owner: string,
    send: (points: LocationPointBody[]) => Promise<LocationBatchResult>,
    shiftKnown: (shiftId: string) => Promise<boolean>,
  ): Promise<{ sent: number }> {
    let sent = 0;
    const known = new Map<string, boolean>();
    for (;;) {
      const records = await this.db.all<PointRecord>(
        'SELECT * FROM location_buffer WHERE owner = ? ORDER BY captured_at, id',
        [owner],
      );
      const ready: PointRecord[] = [];
      for (const record of records) {
        if (!known.has(record.shift_id))
          known.set(record.shift_id, await shiftKnown(record.shift_id));
        if (known.get(record.shift_id)) ready.push(record);
        if (ready.length === FLUSH_LIMIT) break;
      }
      if (ready.length === 0) return { sent };
      const answer = await send(
        ready.map((record) => ({
          id: record.id,
          shiftId: record.shift_id,
          capturedAt: new Date(record.captured_at).toISOString(),
          location: { lat: record.lat, lng: record.lng },
          accuracy: record.accuracy,
          speed: record.speed,
          mocked: record.mocked === 1,
          source: record.source,
          battery: record.battery,
        })),
      );
      const done = [...answer.accepted, ...answer.rejected.map((entry) => entry.id)];
      await this.db.transaction(async (tx) => {
        for (const id of done) await tx.run('DELETE FROM location_buffer WHERE id = ?', [id]);
      });
      sent += ready.length;
      // A server that answered for none of them would loop: stop and try again later.
      if (done.length === 0 || ready.length < FLUSH_LIMIT) return { sent };
    }
  }
}
