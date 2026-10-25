import { Injectable } from '@nestjs/common';
import {
  type CellFiguresShape,
  type CellHealthResult,
  type HealthHour,
  healthIssues,
} from '@thelamp/shared';
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import { cellHealth, cells } from '../../db/schema/directory';
import { CellHealthRecorder } from '../../platform/planes';
import { DirectoryDatabase } from './directory.database';

/** Minutes are kept two days; the console shows the last one. */
const KEEP_MS = 2 * 86_400_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const worst = (values: (number | null)[]) =>
  values.reduce<number | null>(
    (most, value) => (value === null ? most : Math.max(most ?? 0, value)),
    null,
  );

/**
 * Health per cell, kept by the directory (module M22, decision D93): each cell's scheduler
 * reports a minute at a time, and the console reads the latest minute, what needs looking at, and
 * the last day an hour at a time.
 */
@Injectable()
export class CellHealthService extends CellHealthRecorder {
  constructor(private readonly database: DirectoryDatabase) {
    super();
  }

  /** Keeps a cell's minute; the same minute again, from a second scheduler, changes nothing. */
  async record(cellName: string, at: Date, figures: CellFiguresShape): Promise<void> {
    const [cell] = await this.database.db
      .select({ id: cells.id })
      .from(cells)
      .where(eq(cells.name, cellName));
    if (!cell) return;
    await this.database.db.transaction(async (tx) => {
      await tx.insert(cellHealth).values({ cellId: cell.id, at, figures }).onConflictDoNothing();
      await tx
        .delete(cellHealth)
        .where(
          and(eq(cellHealth.cellId, cell.id), lt(cellHealth.at, new Date(at.getTime() - KEEP_MS))),
        );
    });
  }

  /** Every cell's latest minute, what needs looking at, and its last day by the hour. */
  async report(now = new Date()): Promise<CellHealthResult[]> {
    const all = await this.database.db.select().from(cells).orderBy(asc(cells.name));
    return Promise.all(
      all.map(async (cell) => {
        const minutes = await this.database.db
          .select({ at: cellHealth.at, figures: cellHealth.figures })
          .from(cellHealth)
          .where(
            and(
              eq(cellHealth.cellId, cell.id),
              gte(cellHealth.at, new Date(now.getTime() - DAY_MS)),
            ),
          )
          .orderBy(desc(cellHealth.at));
        const latest = minutes[0] ?? null;
        return {
          cell: { name: cell.name, region: cell.region, kind: cell.kind },
          latest: latest ? { at: latest.at.toISOString(), figures: latest.figures } : null,
          issues: healthIssues(latest, now),
          hours: byHour(minutes),
        };
      }),
    );
  }
}

/** Minutes summed, or at their worst, an hour at a time, newest first. */
function byHour(minutes: { at: Date; figures: CellFiguresShape }[]): HealthHour[] {
  const hours = new Map<number, { at: Date; figures: CellFiguresShape }[]>();
  for (const minute of minutes) {
    const hour = Math.floor(minute.at.getTime() / HOUR_MS) * HOUR_MS;
    hours.set(hour, [...(hours.get(hour) ?? []), minute]);
  }
  return [...hours.entries()]
    .sort(([a], [b]) => b - a)
    .map(([hour, rows]) => {
      const sum = (field: 'requests' | 'errors' | 'points' | 'latePoints') =>
        rows.reduce((total, row) => total + row.figures[field], 0);
      return {
        hour: new Date(hour).toISOString(),
        requests: sum('requests'),
        errors: sum('errors'),
        points: sum('points'),
        latePoints: sum('latePoints'),
        worstQueueWaitSeconds: worst(
          rows.flatMap((row) =>
            Object.values(row.figures.queues).map((queue) => queue.oldestWaitSeconds),
          ),
        ),
        worstSyncSeconds: worst(rows.map((row) => row.figures.phones.oldestQueuedSeconds)),
        minutes: rows.length,
      };
    });
}
