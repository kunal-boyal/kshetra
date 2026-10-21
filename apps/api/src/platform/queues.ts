import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type Job, type JobsOptions, Queue, Worker } from 'bullmq';
import type { Config } from '../config';
import { CONFIG } from './tokens';

/** The queues of spec 12.3. Each arrives with the work that uses it. */
export const QUEUE_NAMES = ['maintenance', 'imports', 'media', 'notifications'] as const;
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

/** How many jobs of a queue one worker process runs at once. */
const CONCURRENCY: Record<QueueName, number> = {
  maintenance: 1,
  imports: 2,
  media: 2,
  notifications: 4,
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
  private readonly handlers = new Map<QueueName, Map<string, JobHandler>>();
  private readonly workers: Worker<JobData>[] = [];

  constructor(@Inject(CONFIG) private readonly config: Config) {}

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
  handle(name: QueueName, kind: string, handler: JobHandler): void {
    const kinds = this.handlers.get(name) ?? new Map<string, JobHandler>();
    if (kinds.has(kind)) throw new Error(`The ${name} queue already handles ${kind} jobs.`);
    kinds.set(kind, handler);
    this.handlers.set(name, kinds);
  }

  /** Starts a worker for every queue that has handlers: the worker process only. */
  startWorkers(): void {
    for (const [name, kinds] of this.handlers) {
      const worker = new Worker<JobData>(
        name,
        async (job) => {
          const handler = kinds.get(job.name);
          if (!handler) throw new Error(`Nothing handles ${job.name} jobs on the ${name} queue.`);
          await handler(job.data, job);
        },
        { ...this.options, concurrency: CONCURRENCY[name] },
      );
      worker.on('failed', (job, error) =>
        this.logger.warn(`${name}/${job?.name ?? '?'} failed: ${error.message}`),
      );
      worker.on('error', (error) => this.logger.warn(`The ${name} worker: ${error.message}`));
      this.workers.push(worker);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
