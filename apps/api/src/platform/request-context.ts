import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyRequest } from 'fastify';

/** The request being served, for what is logged or kept while serving it (decision D101). */
const current = new AsyncLocalStorage<FastifyRequest>();

/** Runs the rest of a request's handling with it as the current request. */
export function withRequest(request: FastifyRequest, next: () => void): void {
  current.run(request, next);
}

/** The request being served, if any: none in workers, the scheduler and scripts. */
export function currentRequest(): FastifyRequest | undefined {
  return current.getStore();
}
