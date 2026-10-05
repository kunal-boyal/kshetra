import type { IncomingMessage } from 'node:http';
import { newId } from '@kshetra/shared';

const WELL_FORMED = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * The request's ID (spec 11.1 `X-Request-Id`). A well-formed ID from the caller is kept, so one ID
 * follows a request from phone to database. Anything else, including text that could forge log
 * lines, is replaced with a new one.
 */
export function requestIdFor(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && WELL_FORMED.test(value) ? value : newId();
}

/** Fastify's `genReqId`. */
export function genReqId(request: IncomingMessage): string {
  return requestIdFor(request.headers['x-request-id']);
}
