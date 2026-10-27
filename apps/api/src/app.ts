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
import { clientAddress, trustHops } from './platform/client-address';
import { ErrorFilter } from './platform/errors';
import { withRequest } from './platform/request-context';
import { callerOf, SecurityLog } from './platform/security-log';
import { genReqId } from './platform/request-id';
import { HealthCounters } from './platform/health-counters';

/** The devices no API answer may use, as the web apps' CloudFront sends (decision D101). */
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

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
  const hops = config.TRUST_PROXY;
  const adapter = new FastifyAdapter({
    genReqId,
    bodyLimit: 1_048_576,
    trustProxy: hops === false ? false : trustHops(hops),
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config), adapter, {
    logger,
  });
  app.useGlobalFilters(new ErrorFilter(app.get(SecurityLog)));
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
  // Who is calling, once for every handler, rate limit and audit entry (decision D101).
  fastify.decorateRequest('clientIp', '');
  fastify.addHook('onRequest', (request, _reply, done) => {
    request.clientIp = clientAddress(request, config.ORIGIN_SECRET);
    // Security events logged while serving it name the request (decision D101).
    withRequest(request, done);
  });
  fastify.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    // Every answer is for its caller alone, read as the type it says, and never drawn in a
    // frame (spec 13.1, decision D101); a route that may be cached or shown says so itself.
    if (!reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
    void reply.header('x-content-type-options', 'nosniff');
    if (!reply.hasHeader('content-security-policy')) {
      void reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    }
    void reply.header('referrer-policy', 'no-referrer');
    // No other site may embed an answer, share a window with the reference page, or give it
    // devices (ZAP's findings, decision D101); the web apps call the API from its own origin.
    void reply.header('cross-origin-resource-policy', 'same-origin');
    void reply.header('cross-origin-opener-policy', 'same-origin');
    void reply.header('cross-origin-embedder-policy', 'require-corp');
    void reply.header('permissions-policy', PERMISSIONS_POLICY);
    if (config.NODE_ENV === 'production') {
      void reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains');
    }
  });
  const http = new Logger('HTTP');
  const health = app.get(HealthCounters);
  fastify.addHook('onResponse', async (request, reply) => {
    // Each answer counts toward the cell's health, server errors as errors (decision D93).
    health.request(reply.statusCode);
    // The path only: query strings can carry tokens or signed URLs, which never go in logs (spec 13.1).
    // The tenant, caller and address say who asked (spec 13.1, ASVS V16.2.1, decision D101).
    http.log({
      requestId: request.id,
      method: request.method,
      path: request.url.split('?')[0],
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
      ip: request.clientIp,
      ...callerOf(request),
    });
  });
  return app;
}
