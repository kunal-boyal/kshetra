import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { QUEUE_DEFAULT_SLOTS } from '@thelamp/shared';
import { DelayedError, type Job, type JobsOptions, Queue, Worker } from 'bullmq';
import type { Config } from '../config';
import { reportError } from './error-reports';
import { Entitlements } from './planes';
import { TenantSlots } from './tenant-slots';
import { CONFIG } from './tokens';

/** The queues of spec 12.3. Each arrives with the work that uses it. */
export const QUEUE_NAMES = [
  'maintenance',
  'imports',
  'media',
  'notifications',
  'exports',
  'webhooks',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * What a job carries. Work for one tenant names it, and its handler sets the tenant's RLS context
 * through `Database.forTenant`; work across the cell, such as housekeeping, names none.
 */
export interface JobData {
  tenantId?: string;
  [field: string]: unknown;
}

export type JobHandler = (data: JobData, job: Job<JobData>) => Promise<void>;

export interface HandlerOptions {
  /**
   * Heavy work, such as an import, an export or a recompute: each tenant runs at most its plan's
   * `queueSlots` of these at once on the queue, so one tenant's backlog can't hold up the others
   * (spec 10.3, decision D98). A job over the limit waits a few seconds and tries again, without
   * spending an attempt.
   */
  perTenant?: boolean;
}

/** How long a running job holds its tenant's slot if its worker dies without giving it back. */
const SLOT_HOLD_MS = 60 * 60_000;

/** How many jobs of a queue one worker process runs at once. */
const CONCURRENCY: Record<QueueName, number> = {
  maintenance: 1,
  imports: 2,
  media: 2,
  notifications: 4,
  // A file holds a month of a report in memory while it is written: two at a time.
  exports: 2,
  // Each try waits on a receiver for up to ten seconds.
  webhooks: 8,
};

/**
 * Background jobs on BullMQ (spec 12.3). Any process adds jobs; modules register a handler per
 * kind of job; only the worker process runs them. A failed job is retried with backoff, 5 times
 * by default, and jobs added with the same ID are added once.
 */
@Injectable()
export class Queues implements OnModuleDestroy {
  private readonly logger = new Logger(Queues.name);
  private readonly queues = new Map<QueueName, Queue<JobData>>();
  private readonly handlers = new Map<
    QueueName,
    Map<string, { handler: JobHandler; options: HandlerOptions }>
  >();
  private readonly workers: Worker<JobData>[] = [];

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly slots: TenantSlots,
    private readonly modules: ModuleRef,
  ) {}

  private get options() {
    return {
      // BullMQ's blocking reads need unlimited retries per request.
      connection: { url: this.config.REDIS_URL, maxRetriesPerRequest: null },
      prefix: this.config.QUEUE_PREFIX ?? `${this.config.PRODUCT_SLUG}:bull`,
    };
  }

  /** The queue itself, for schedules and tests. */
  queue(name: QueueName): Queue<JobData> {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue<JobData>(name, {
        ...this.options,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          // Finished jobs stay a while, so an ID added again in that time is still recognised.
          removeOnComplete: { age: 7 * 86_400, count: 10_000 },
          removeOnFail: { age: 30 * 86_400 },
        },
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /** Adds a job. With `jobId`, adding the same job again does nothing while the first is kept. */
  async add(
    name: QueueName,
    kind: string,
    data: JobData,
    options: JobsOptions = {},
  ): Promise<void> {
    await this.queue(name).add(kind, data, options);
  }

  /** Registers what runs one kind of job. The worker process runs it. */
  handle(name: QueueName, kind: string, handler: JobHandler, options: HandlerOptions = {}): void {
    const kinds =
      this.handlers.get(name) ??
      new Map<string, { handler: JobHandler; options: HandlerOptions }>();
    if (kinds.has(kind)) throw new Error(`The ${name} queue already handles ${kind} jobs.`);
    kinds.set(kind, { handler, options });
    this.handlers.set(name, kinds);
  }

  /** Runs a job, within its tenant's slots when its kind is heavy. */
  async run(name: QueueName, job: Job<JobData>, token?: string): Promise<void> {
    const found = this.handlers.get(name)?.get(job.name);
    if (!found) throw new Error(`Nothing handles ${job.name} jobs on the ${name} queue.`);
    const tenantId = job.data.tenantId;
    if (!found.options.perTenant || !tenantId || !job.id) {
      await found.handler(job.data, job);
      return;
    }
    const { limits } = await this.modules.get(Entitlements, { strict: false }).forTenant(tenantId);
    const limit = limits.queueSlots ?? QUEUE_DEFAULT_SLOTS;
    if (!(await this.slots.take(name, tenantId, job.id, limit, SLOT_HOLD_MS))) {
      // The tenant's slots are taken: come back in a few seconds, without spending an attempt.
      await job.moveToDelayed(Date.now() + 3_000 + Math.floor(Math.random() * 2_000), token);
      throw new DelayedError();
    }
    try {
      await found.handler(job.data, job);
    } finally {
      await this.slots.release(name, tenantId, job.id);
    }
  }

  /** Starts a worker for every queue that has handlers: the worker process only. */
  startWorkers(): void {
    for (const [name, kinds] of this.handlers) {
      if (kinds.size === 0) continue;
      const worker = new Worker<JobData>(name, (job, token) => this.run(name, job, token), {
        ...this.options,
        concurrency: CONCURRENCY[name],
      });
      worker.on('failed', (job, error) => {
        this.logger.warn(`${name}/${job?.name ?? '?'} failed: ${error.message}`);
        // Only a job's last try is reported; earlier ones are retried (decision D98).
        if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
          reportError(error, { queue: name, job: job.name, tenant: job.data.tenantId });
        }
      });
      worker.on('error', (error) => this.logger.warn(`The ${name} worker: ${error.message}`));
      this.workers.push(worker);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
