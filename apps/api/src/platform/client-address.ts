import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** The caller's address, as `clientAddress()` finds it; set as each request arrives. */
    clientIp: string;
  }
}

/** The header CloudFront's viewer-request function writes with the viewer's own address. */
export const VIEWER_ADDRESS_HEADER = 'x-viewer-address';

/**
 * Fastify's trust for `hops` proxies: the first `hops` addresses back from the socket are proxies,
 * and the next one in X-Forwarded-For is the caller. Anything a caller wrote further left is not.
 */
export function trustHops(hops: number) {
  return (_address: string, hop: number) => hop < hops;
}

function same(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The caller's address, which rate limits key on and the audit records (decision D101). Phones
 * reach the load balancer directly, so it is the address the balancer saw (`TRUST_PROXY` counts
 * that one hop). Browsers come through CloudFront, whose address the balancer sees instead; for a
 * request carrying CloudFront's origin secret, the viewer's address CloudFront wrote is the
 * caller's. Without the secret that header is a caller's own claim and is ignored.
 */
export function clientAddress(request: FastifyRequest, originSecret: string | undefined): string {
  const verify = request.headers['x-origin-verify'];
  const viewer = request.headers[VIEWER_ADDRESS_HEADER];
  if (
    originSecret &&
    typeof verify === 'string' &&
    same(verify, originSecret) &&
    typeof viewer === 'string' &&
    isIP(viewer) !== 0
  ) {
    return viewer;
  }
  return request.ip;
}

/** The caller's address in a handler, in place of `@Ip()`, which believes the nearest proxy. */
export const ClientIp = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<FastifyRequest>().clientIp,
);
