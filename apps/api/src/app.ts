import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
import { APP_PLATFORM_HEADER, APP_VERSION_HEADER, WEB_CLIENT_HEADER } from '@thelamp/shared';
import { ConsoleLogger, Logger, type LoggerService, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { LOGO_MAX_BYTES } from '@thelamp/shared';
import { MAX_FILE_BYTES } from './modules/imports/reading';
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
  const adapter = new FastifyAdapter({
    genReqId,
    bodyLimit: 1_048_576,
    trustProxy: config.TRUST_PROXY,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config), adapter, {
    logger,
  });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  // The web's refresh token travels in a cookie (spec 13.1).
  await app.register(fastifyCookie);
  if (config.CORS_ORIGINS.length > 0) {
    app.enableCors({
      origin: config.CORS_ORIGINS,
      credentials: true,
      allowedHeaders: [
        'authorization',
        'content-type',
        'idempotency-key',
        'if-none-match',
        'x-request-id',
        'x-device-time',
        APP_PLATFORM_HEADER,
        APP_VERSION_HEADER,
        WEB_CLIENT_HEADER,
      ],
      exposedHeaders: ['etag', 'retry-after', 'x-request-id'],
      maxAge: 600,
    });
  }

  const fastify = app.getHttpAdapter().getInstance();
  // Import files arrive as the request body itself (M19), up to 20 MB; everything else stays
  // within the 1 MB limit.
  fastify.addContentTypeParser(
    [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
    ],
    { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES },
    (_request, body, done) => done(null, body),
  );
  // A logo arrives as the body too (M2, decision D64): an image of at most 2 MB.
  fastify.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/webp'],
    { parseAs: 'buffer', bodyLimit: LOGO_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );
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
