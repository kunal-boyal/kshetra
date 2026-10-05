import 'reflect-metadata';
import { ConsoleLogger, Logger, type LoggerService, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import type { Config } from './config';
import { ErrorFilter } from './platform/errors';
import { genReqId } from './platform/request-id';

const LEVELS: Record<Config['LOG_LEVEL'], LogLevel[]> = {
  debug: ['debug', 'log', 'warn', 'error', 'fatal'],
  info: ['log', 'warn', 'error', 'fatal'],
  warn: ['warn', 'error', 'fatal'],
  error: ['error', 'fatal'],
};

/** Structured JSON logs, one object per line (spec 9.2). */
export function createLogger(config: Config): LoggerService {
  return new ConsoleLogger({ json: true, logLevels: LEVELS[config.LOG_LEVEL] });
}

/** Builds the HTTP application; main.ts listens, tests inject requests. */
export async function createApp(
  config: Config,
  logger: LoggerService | false = createLogger(config),
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ genReqId, bodyLimit: 1_048_576 });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config), adapter, {
    logger,
  });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });
  const http = new Logger('HTTP');
  fastify.addHook('onResponse', async (request, reply) => {
    // The path only: query strings can carry tokens or signed URLs, which never go in logs (spec 13.1).
    http.log({
      requestId: request.id,
      method: request.method,
      path: request.url.split('?')[0],
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
    });
  });
  return app;
}
