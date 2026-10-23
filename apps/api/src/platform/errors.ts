import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import {
  AppError,
  ERROR_HTTP_STATUS,
  type ErrorBody,
  type ErrorCode,
  type ErrorDetail,
  formatPath,
} from '@thelamp/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION: 'Some of the request is not valid.',
  UNAUTHENTICATED: 'Sign in to continue.',
  FORBIDDEN: 'You do not have access to this.',
  NOT_FOUND: 'This was not found.',
  CONFLICT: 'This conflicts with a change made elsewhere. Refresh and try again.',
  RATE_LIMITED: 'Too many requests. Wait a moment, then try again.',
  INTERNAL: 'Something went wrong. Try again in a moment.',
};

function codeForStatus(status: number): ErrorCode {
  if (status >= 500) return 'INTERNAL';
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
    case 405:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'VALIDATION';
  }
}

function body(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: ErrorDetail[],
): ErrorBody {
  return { error: { code, message, ...(details ? { details } : {}), requestId } };
}

/** Turns anything thrown while handling a request into the error response of spec 11.1. */
export function toErrorResponse(
  exception: unknown,
  requestId: string,
): { status: number; body: ErrorBody; headers?: Record<string, string> } {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      body: body(exception.code, exception.message, requestId, exception.details),
      ...(exception.retryAfterSeconds === undefined
        ? {}
        : { headers: { 'retry-after': String(exception.retryAfterSeconds) } }),
    };
  }
  if (exception instanceof ZodError) {
    const details = exception.issues.map((issue) => ({
      path: formatPath(issue.path),
      issue: issue.message,
    }));
    return {
      status: 400,
      body: body('VALIDATION', 'Check the highlighted fields.', requestId, details),
    };
  }
  // Nest's own exceptions, and Fastify's (a malformed body, an unsupported media type) carry a status.
  const status =
    exception instanceof HttpException
      ? exception.getStatus()
      : typeof (exception as { statusCode?: unknown })?.statusCode === 'number'
        ? (exception as { statusCode: number }).statusCode
        : 500;
  const code = status >= 400 && status < 600 ? codeForStatus(status) : 'INTERNAL';
  return {
    status: ERROR_HTTP_STATUS[code],
    body: body(code, MESSAGES[code] ?? MESSAGES.VALIDATION!, requestId),
  };
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const { status, body, headers } = toErrorResponse(exception, String(request.id));
    if (status >= 500) {
      const detail =
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      this.logger.error({ requestId: request.id, error: detail });
    }
    if (headers) void reply.headers(headers);
    void reply.status(status).send(body);
  }
}
