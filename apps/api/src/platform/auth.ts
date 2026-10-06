import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessClaims, AppError } from '@kshetra/shared';
import type { FastifyRequest } from 'fastify';
import { createLocalJWKSet, errors, type JSONWebKeySet, jwtVerify } from 'jose';
import type { Config } from '../config';
import { CONFIG } from './tokens';

/** Who is calling, from a verified access token (spec 11.1). */
export interface AuthContext {
  userId: string;
  tenantId: string;
  cell: string;
  /** The auth revision the token was issued at (BR-39). */
  revision: number;
  deviceId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const PUBLIC_ROUTE = 'public-route';

/** Marks a route or controller that needs no access token: health checks and sign-in. */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** The caller of a guarded route. */
export const CurrentAuth = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const auth = context.switchToHttp().getRequest<FastifyRequest>().auth;
  if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  return auth;
});

/**
 * The public keys access tokens are checked against. The directory module provides them; once the
 * directory runs as its own service, cells fetch the same set from its JWKS endpoint (spec 9.3).
 */
export abstract class TokenKeys {
  abstract jwks(): Promise<JSONWebKeySet>;
}

/** Token issuer and audience, both derived from the product slug. */
export function tokenParties(config: Config): { issuer: string; audience: string } {
  return { issuer: `${config.PRODUCT_SLUG}:directory`, audience: `${config.PRODUCT_SLUG}:cell` };
}

/** Checks access tokens: signature, expiry, issuer, audience and the shape of the claims. */
@Injectable()
export class AccessTokens {
  private keySet: ReturnType<typeof createLocalJWKSet> | undefined;

  constructor(
    private readonly keys: TokenKeys,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async verify(token: string): Promise<AccessClaims> {
    this.keySet ??= createLocalJWKSet(await this.keys.jwks());
    try {
      const { payload } = await jwtVerify(token, this.keySet, {
        ...tokenParties(this.config),
        algorithms: ['ES256'],
        clockTolerance: 5,
      });
      const claims = AccessClaims.safeParse(payload);
      if (!claims.success) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
      return claims.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof errors.JWTExpired) {
        throw new AppError('TOKEN_EXPIRED', 'Your session needs refreshing.');
      }
      throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
    }
  }
}

/**
 * Every route needs a valid access token for this cell unless it is marked `@Public()`. Later
 * steps add the per-request checks of the user, device and auth revision (BR-39) and the
 * permission and scope checks (spec 4.2).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokens,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
    }
    const claims = await this.tokens.verify(token);
    if (claims.cell !== this.config.CELL_ID) {
      throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
    }
    request.auth = {
      userId: claims.sub,
      tenantId: claims.tid,
      cell: claims.cell,
      revision: claims.rev,
      ...(claims.did ? { deviceId: claims.did } : {}),
    };
    return true;
  }
}
