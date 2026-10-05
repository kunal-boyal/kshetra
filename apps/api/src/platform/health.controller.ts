import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Database } from './database';

/** `/health` and `/ready`, on every service (spec 11.1). */
@Controller()
export class HealthController {
  constructor(private readonly database: Database) {}

  /** Liveness: the process is up and answering. */
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: the process can do real work, which needs the database. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    if (!(await this.database.ping())) {
      void reply.status(503);
      return { status: 'not_ready', checks: { database: 'unavailable' } };
    }
    return { status: 'ready', checks: { database: 'ok' } };
  }
}
