import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importPKCS8,
  type JSONWebKeySet,
  type JWK,
  SignJWT,
} from 'jose';
import type { Config } from '../../config';
import { TokenKeys, tokenParties } from '../../platform/auth';
import { CONFIG } from '../../platform/tokens';

/** Access tokens live 15 minutes (M1, rule 6). */
export const ACCESS_TOKEN_SECONDS = 15 * 60;

export interface AccessTokenInput {
  userId: string;
  tenantId: string;
  cell: string;
  revision: number;
  /** The bound phone; the web has none. */
  deviceId?: string;
  /** Vendor support's grant (decision D93); `userId` is then the staff member's. */
  supportGrantId?: string;
  /** An API client's scopes (decision D94); `userId` is then the client's ID. */
  scopes?: readonly string[];
  /** How long the token lasts, when not the usual. */
  seconds?: number;
  /** The session, its refresh-token family (decision D101); API clients' tokens have none. */
  sessionId?: string;
  /** When the session last gave a fresh authenticator code (decision D101). */
  steppedUpAt?: Date | null;
}

/**
 * The directory's ES256 key (spec 9.2). It signs access tokens, and its public half is the JWKS
 * that cells verify against. The key comes from `JWT_SIGNING_KEY`, checked at start-up. Outside
 * production, without one, a temporary key is made when first needed, so processes that never
 * sign, such as the worker, make none; tokens stop working when the API restarts.
 */
@Injectable()
export class SigningKey extends TokenKeys implements OnModuleInit {
  private readonly logger = new Logger(SigningKey.name);
  private privateKey: Awaited<ReturnType<typeof importPKCS8>> | undefined;
  private publicJwk: JWK | undefined;
  private loading: Promise<void> | undefined;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (this.config.JWT_SIGNING_KEY) await this.load();
  }

  private load(): Promise<void> {
    this.loading ??= this.read();
    return this.loading;
  }

  private async read(): Promise<void> {
    if (this.config.JWT_SIGNING_KEY) {
      this.privateKey = await importPKCS8(this.config.JWT_SIGNING_KEY, 'ES256', {
        extractable: true,
      });
    } else {
      this.logger.warn('No JWT_SIGNING_KEY: signing with a temporary key until the API restarts.');
      this.privateKey = (await generateKeyPair('ES256', { extractable: true })).privateKey;
    }
    // The private JWK minus its secret part `d` is the public key.
    const { kty, crv, x, y } = await exportJWK(this.privateKey);
    const jwk: JWK = { kty, crv, x, y };
    this.publicJwk = { ...jwk, kid: await calculateJwkThumbprint(jwk), alg: 'ES256', use: 'sig' };
  }

  async jwks(): Promise<JSONWebKeySet> {
    await this.load();
    if (!this.publicJwk) throw new Error('The signing key is not loaded yet.');
    return { keys: [this.publicJwk] };
  }

  /** Signs an access token. `now` lets tests make tokens that are already old. */
  async sign(
    input: AccessTokenInput,
    now: Date = new Date(),
  ): Promise<{ token: string; expiresAt: Date }> {
    await this.load();
    if (!this.privateKey || !this.publicJwk) throw new Error('The signing key is not loaded yet.');
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAt = new Date((issuedAt + (input.seconds ?? ACCESS_TOKEN_SECONDS)) * 1000);
    const { issuer, audience } = tokenParties(this.config);
    const token = await new SignJWT({
      tid: input.tenantId,
      cell: input.cell,
      rev: input.revision,
      ...(input.deviceId ? { did: input.deviceId } : {}),
      ...(input.supportGrantId ? { sg: input.supportGrantId } : {}),
      ...(input.scopes ? { scp: [...input.scopes] } : {}),
      ...(input.sessionId ? { sid: input.sessionId } : {}),
      ...(input.steppedUpAt ? { sua: Math.floor(input.steppedUpAt.getTime() / 1000) } : {}),
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.publicJwk.kid!, typ: 'JWT' })
      .setSubject(input.userId)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.privateKey);
    return { token, expiresAt };
  }

  /**
   * Signs a console token for vendor staff (decision D88): the same key and lifetime, for the
   * platform audience, so no cell takes it and the console takes no tenant user's.
   */
  async signStaff(
    input: { staffId: string; role: string; revision: number; sessionId?: string },
    now: Date = new Date(),
  ): Promise<{ token: string; expiresAt: Date }> {
    await this.load();
    if (!this.privateKey || !this.publicJwk) throw new Error('The signing key is not loaded yet.');
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAt = new Date((issuedAt + ACCESS_TOKEN_SECONDS) * 1000);
    const { issuer, staffAudience } = tokenParties(this.config);
    const token = await new SignJWT({
      role: input.role,
      rev: input.revision,
      ...(input.sessionId ? { sid: input.sessionId } : {}),
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.publicJwk.kid!, typ: 'JWT' })
      .setSubject(input.staffId)
      .setIssuer(issuer)
      .setAudience(staffAudience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.privateKey);
    return { token, expiresAt };
  }
}
