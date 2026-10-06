import { Controller, Get, Inject, Res } from '@nestjs/common';
import { HealthResult, ReadyResult } from '@kshetra/shared';
import type { FastifyReply } from 'fastify';
import { Public } from './auth';
import { Contract } from './routes';

/** What readiness depends on, by name: each answers whether it is reachable. */
export const HEALTH_CHECKS = Symbol('HEALTH_CHECKS');
export type HealthChecks = Record<string, () => Promise<boolean>>;

/** `/health` and `/ready`, on every service (spec 11.1). */
@Public()
@Controller()
export class HealthController {
  constructor(@Inject(HEALTH_CHECKS) private readonly checks: HealthChecks) {}

  /** Liveness: the process is up and answering. */
  @Get('health')
  @Contract({ tag: 'Health', summary: 'Whether the process is up', response: HealthResult })
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: everything real work needs answers. */
  @Get('ready')
  @Contract({
    tag: 'Health',
    summary: 'Whether everything real work needs answers',
    response: ReadyResult,
    also: [{ status: 503, description: 'Something real work needs is not answering' }],
  })
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const names = Object.keys(this.checks);
    const results = await Promise.all(names.map((name) => this.checks[name]!()));
    const checks = Object.fromEntries(
      names.map((name, i) => [name, results[i] ? 'ok' : 'unavailable']),
    );
    if (results.every(Boolean)) return { status: 'ready', checks };
    void reply.status(503);
    return { status: 'not_ready', checks };
  }
}
