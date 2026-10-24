import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AccessClaims,
  AppError,
  closedByModules,
  type DataScope,
  type PlatformPermission,
  type PlatformRoleKey,
  StaffClaims,
  type SwitchableModule,
  type TenantPermission,
} from '@thelamp/shared';
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
  /** The bound phone the session runs on; web sessions have none. */
  deviceId?: string;
  /** The caller's address, for the audit log. */
  ip?: string;
}

/**
 * The caller's access, read from the tenant's data on every request (spec 4.2, BR-39): their role,
 * what it permits, and whose records it reaches.
 */
export interface Access extends AuthContext {
  roleId: string;
  roleKey: string;
  scope: DataScope;
  /** The role's permissions, less those of modules the tenant switched off (spec 5.13). */
  permissions: ReadonlySet<TenantPermission>;
  modulesOff: readonly SwitchableModule[];
}

declare module 'fastify' {
  interface FastifyRequest {
    access?: Access;
  }
}

/**
 * Checks that the caller's user, tenant and device are still active and the token's auth revision
 * is current, then returns their access. IAM provides it.
 */
export abstract class AccessResolver {
  abstract resolve(auth: AuthContext): Promise<Access>;
  /** Someone's access now, for background work done on their behalf, such as an import. */
  abstract onBehalfOf(tenantId: string, userId: string, cell: string): Promise<Access>;
}

export type AccessRule =
  | { kind: 'public' }
  | { kind: 'signed_in' }
  | { kind: 'all' | 'any'; permissions: readonly TenantPermission[] }
  | { kind: 'staff'; permissions: readonly PlatformPermission[] };

/** A vendor staff member calling the platform console's API (module M22, decision D88). */
export interface StaffAccess {
  staffId: string;
  role: PlatformRoleKey;
  permissions: ReadonlySet<PlatformPermission>;
  ip?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffAccess;
  }
}

/**
 * Checks that a staff member is still active at their token's revision, and returns what they may
 * do. The console module provides it.
 */
export abstract class StaffResolver {
  abstract resolve(claims: StaffClaims, ip?: string): Promise<StaffAccess>;
}

const ACCESS_RULE = 'access-rule';

/**
 * Every route declares who may call it, and a route that declares nothing is refused (spec 4.2:
 * the server checks permission on every read and write).
 */

/** No access token needed: health checks and sign-in. */
export const Public = () => SetMetadata(ACCESS_RULE, { kind: 'public' } satisfies AccessRule);

/** Anyone signed in to the tenant. */
export const SignedIn = () => SetMetadata(ACCESS_RULE, { kind: 'signed_in' } satisfies AccessRule);

/** Callers whose role holds every one of these permissions. */
export const Requires = (...permissions: [TenantPermission, ...TenantPermission[]]) =>
  SetMetadata(ACCESS_RULE, { kind: 'all', permissions } satisfies AccessRule);

/** Callers whose role holds at least one of these permissions. */
export const RequiresAny = (...permissions: [TenantPermission, ...TenantPermission[]]) =>
  SetMetadata(ACCESS_RULE, { kind: 'any', permissions } satisfies AccessRule);

/**
 * Vendor staff in the platform console, holding every one of these permissions; none means any
 * active staff member. Tenant users' tokens never pass, nor do staff tokens on tenant routes.
 */
export const ForStaff = (...permissions: PlatformPermission[]) =>
  SetMetadata(ACCESS_RULE, { kind: 'staff', permissions } satisfies AccessRule);

/** The staff member calling a console route. */
export const CurrentStaff = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const staff = context.switchToHttp().getRequest<FastifyRequest>().staff;
  if (!staff) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  return staff;
});

const MODULE = 'module';

/**
 * A route that belongs to a switchable module (spec 5.13): while the tenant has it off, the route
 * answers `MODULE_DISABLED`. Routes whose permissions all belong to switched-off modules answer it
 * without this.
 */
export const InModule = (module: SwitchableModule) => SetMetadata(MODULE, module);

/** The module a handler or its controller belongs to, read without a running app. */
export function moduleOfRoute(handler: object, controller: object): SwitchableModule | undefined {
  return (Reflect.getMetadata(MODULE, handler) ?? Reflect.getMetadata(MODULE, controller)) as
    SwitchableModule | undefined;
}

/** The answer for a module the tenant switched off (M2). */
export const moduleDisabled = () =>
  new AppError('MODULE_DISABLED', 'Your organisation has switched this part of the product off.');

/** The access rule a route declares on its handler or its controller, or undefined for none. */
export function accessRule(
  reflector: Reflector,
  targets: Parameters<Reflector['getAllAndOverride']>[1],
): AccessRule | undefined {
  return reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_RULE, targets);
}

/** The rule a handler declares, or else its controller's, read without a running app. */
export function accessRuleOf(handler: object, controller: object): AccessRule | undefined {
  return (Reflect.getMetadata(ACCESS_RULE, handler) ??
    Reflect.getMetadata(ACCESS_RULE, controller)) as AccessRule | undefined;
}

/** The caller of a route that is not public. */
export const CurrentAccess = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const access = context.switchToHttp().getRequest<FastifyRequest>().access;
  if (!access) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  return access;
});

/**
 * The public keys access tokens are checked against. The directory module provides them; once the
 * directory runs as its own service, cells fetch the same set from its JWKS endpoint (spec 9.3).
 */
export abstract class TokenKeys {
  abstract jwks(): Promise<JSONWebKeySet>;
}

/**
 * Token issuer and audiences, derived from the product slug: cells take tenant users' tokens, and
 * the platform console its staff's.
 */
export function tokenParties(config: Config): {
  issuer: string;
  audience: string;
  staffAudience: string;
} {
  return {
    issuer: `${config.PRODUCT_SLUG}:directory`,
    audience: `${config.PRODUCT_SLUG}:cell`,
    staffAudience: `${config.PRODUCT_SLUG}:platform`,
  };
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
    const { issuer, audience } = tokenParties(this.config);
    return this.check(token, issuer, audience, AccessClaims);
  }

  /** A console token, for the vendor's own audience. */
  async verifyStaff(token: string): Promise<StaffClaims> {
    const { issuer, staffAudience } = tokenParties(this.config);
    return this.check(token, issuer, staffAudience, StaffClaims);
  }

  private async check<T>(
    token: string,
    issuer: string,
    audience: string,
    shape: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  ): Promise<T> {
    this.keySet ??= createLocalJWKSet(await this.keys.jwks());
    try {
      const { payload } = await jwtVerify(token, this.keySet, {
        issuer,
        audience,
        algorithms: ['ES256'],
        clockTolerance: 5,
      });
      const claims = shape.safeParse(payload);
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
 * Guards every route. Unless the route is public, it needs a valid access token for this cell,
 * an active user, tenant and device at the token's auth revision, and the permissions the route
 * declares.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokens,
    private readonly resolver: AccessResolver,
    private readonly staffResolver: StaffResolver,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = accessRule(this.reflector, [context.getHandler(), context.getClass()]);
    if (rule?.kind === 'public') return true;
    if (!rule) {
      this.logger.error(
        `${context.getClass().name}.${context.getHandler().name} declares no access rule`,
      );
      throw new AppError('FORBIDDEN', 'You do not have access to this.');
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
    }
    if (rule.kind === 'staff') {
      const staff = await this.staffResolver.resolve(
        await this.tokens.verifyStaff(token),
        request.ip,
      );
      request.staff = staff;
      if (!rule.permissions.every((permission) => staff.permissions.has(permission))) {
        throw new AppError('FORBIDDEN', 'You do not have access to this.');
      }
      return true;
    }
    const claims = await this.tokens.verify(token);
    if (claims.cell !== this.config.CELL_ID) {
      throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
    }
    const access = await this.resolver.resolve({
      userId: claims.sub,
      tenantId: claims.tid,
      cell: claims.cell,
      revision: claims.rev,
      ip: request.ip,
      ...(claims.did ? { deviceId: claims.did } : {}),
    });
    request.access = access;

    const module = this.reflector.getAllAndOverride<SwitchableModule | undefined>(MODULE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (module && access.modulesOff.includes(module)) throw moduleDisabled();
    if (rule.kind === 'signed_in') return true;
    const held = (permission: TenantPermission) => access.permissions.has(permission);
    const allowed =
      rule.kind === 'all' ? rule.permissions.every(held) : rule.permissions.some(held);
    if (!allowed) {
      // What the route needs comes only from modules that are off: say so, not "no access".
      if (closedByModules(rule.permissions, access.modulesOff)) throw moduleDisabled();
      throw new AppError('FORBIDDEN', 'You do not have access to this.');
    }
    return true;
  }
}
