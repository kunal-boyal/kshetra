import { z } from 'zod';
import { HEALTH_ISSUES } from '../health';

/** Health per cell (module M22, decision D93), as cells report it and the console reads it. */

const Count = z.int().min(0);
const Seconds = z.int().min(0).nullable();

export const QueueFigures = z.object({
  waiting: Count,
  active: Count,
  delayed: Count,
  failed: Count,
  oldestWaitSeconds: Seconds,
});

export const CellFigures = z
  .object({
    requests: Count,
    errors: Count,
    points: Count,
    latePoints: Count,
    queues: z.record(z.string(), QueueFigures),
    outbox: z.object({ backlog: Count, oldestSeconds: Seconds }),
    phones: z.object({
      seen: Count,
      waiting: Count,
      parked: Count,
      oldestQueuedSeconds: Seconds,
    }),
  })
  .meta({ id: 'CellFigures' });

/** An hour of a cell, summed or at its worst. */
export const HealthHour = z.object({
  hour: z.iso.datetime(),
  requests: Count,
  errors: Count,
  points: Count,
  latePoints: Count,
  worstQueueWaitSeconds: Seconds,
  worstSyncSeconds: Seconds,
  /** Minutes the cell reported in the hour. */
  minutes: Count,
});

export const CellHealth = z
  .object({
    cell: z.object({ name: z.string(), region: z.string(), kind: z.enum(['shared', 'dedicated']) }),
    latest: z.object({ at: z.iso.datetime(), figures: CellFigures }).nullable(),
    issues: z.array(z.object({ key: z.enum(HEALTH_ISSUES), queue: z.string().optional() })),
    /** The last day, an hour at a time, newest first. */
    hours: z.array(HealthHour),
  })
  .meta({ id: 'CellHealth' });

export const CellHealthList = z.object({ items: z.array(CellHealth) });

export type CellHealthResult = z.infer<typeof CellHealth>;
export type HealthHour = z.infer<typeof HealthHour>;
