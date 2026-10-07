import { Injectable } from '@nestjs/common';
import type { QueueName } from './queues';

/** Work repeated on a fixed interval across the cell, such as hourly housekeeping. */
export interface EveryInterval {
  id: string;
  everyMs: number;
  queue: QueueName;
  kind: string;
}

/**
 * Work at a moment of each tenant's local day (spec 12.3), such as the 08:00 plan message or the
 * 01:30 nightly jobs. The scheduler adds one job per open tenant once the tenant's clock passes
 * `at`, keyed to the local date, so the job runs once a day however often the scheduler looks.
 */
export interface TenantMoment {
  name: string;
  /** `HH:MM`, 24-hour, on the tenant's clock. */
  at: string;
  queue: QueueName;
  kind: string;
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Where modules declare scheduled work. The scheduler process reads it and adds the jobs; the
 * worker process runs them through their handlers on `Queues`.
 */
@Injectable()
export class Schedules {
  private readonly intervals = new Map<string, EveryInterval>();
  private readonly moments = new Map<string, TenantMoment>();

  every(work: EveryInterval): void {
    if (this.intervals.has(work.id)) throw new Error(`The schedule ${work.id} exists already.`);
    this.intervals.set(work.id, work);
  }

  atTenantTime(moment: TenantMoment): void {
    if (!HH_MM.test(moment.at)) throw new Error(`${moment.name}: use HH:MM, such as 01:30.`);
    if (this.moments.has(moment.name)) throw new Error(`The moment ${moment.name} exists already.`);
    this.moments.set(moment.name, moment);
  }

  get everyIntervals(): EveryInterval[] {
    return [...this.intervals.values()];
  }

  get tenantMoments(): TenantMoment[] {
    return [...this.moments.values()];
  }
}
