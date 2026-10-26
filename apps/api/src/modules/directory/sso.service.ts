import { Inject, Injectable, Logger } from '@nestjs/common';
import { SAML } from '@node-saml/node-saml';
import {
  AppError,
  type SignedIn,
  type SsoConnectionBody,
  type SsoConnectionResult,
  type SsoFailure,
  type SsoSettings,
} from '@thelamp/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import * as oidc from 'openid-client';
import type { Config } from '../../config';
import { memberships, ssoConnections, tenants } from '../../db/schema/directory';
import { ColumnCipher } from '../../platform/column-cipher';
import { Entitlements, PeopleEmails } from '../../platform/planes';
import { RedisClient } from '../../platform/redis';
import { publicFetch, publicUrlIssue } from '../../platform/outbound';
import { CONFIG } from '../../platform/tokens';
import { DirectoryDatabase } from './directory.database';
import { activeMemberships } from './memberships';
import { digest, newSecret } from './secrets';
import { SessionsService } from './sessions.service';

/** How long a browser has at its identity provider before the sign-in must start again. */
export const SSO_STATE_SECONDS = 10 * 60;

/** An SSO sign-in that came back without a session, and why, for the sign-in page to say. */
export class SsoRefused extends Error {
  constructor(readonly failure: SsoFailure) {
    super(failure);
  }
}

type Stored =
  | { protocol: 'oidc'; issuer: string; clientId: string; clientSecret: string }
  | { protocol: 'saml'; entryPoint: string; idpIssuer: string; idpCertificate: string };

interface Pending {
  tenantId: string;
  protocol: 'oidc' | 'saml';
  verifier?: string;
  nonce?: string;
}

/**
 * Single sign-on for web users (spec M1, D5, decision D91). Each tenant has at most one
 * connection to its identity provider, through OIDC (authorization code with PKCE, state and
 * nonce) or SAML (signed assertions, RelayState), for the email domains it names. Coming back,
 * the active person in that tenant with the provider's email signs in; nobody is created. The
 * settings are sealed in their column, the OIDC client secret among them.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly database: DirectoryDatabase,
    private readonly sessions: SessionsService,
    private readonly cipher: ColumnCipher,
    private readonly client: RedisClient,
    private readonly emails: PeopleEmails,
    private readonly entitlements: Entitlements,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** What the identity provider's admin registers, for a tenant's slug. */
  urls(slug: string) {
    const base = `${this.config.WEB_URL}/auth/v1/sso/${slug}`;
    return {
      redirectUri: `${base}/oidc/callback`,
      entityId: `${base}/saml/metadata`,
      acsUrl: `${base}/saml/acs`,
      metadataUrl: `${base}/saml/metadata`,
    };
  }

  async connection(tenantId: string): Promise<SsoConnectionResult> {
    const tenant = await this.tenant(tenantId);
    const [row] = await this.database.db
      .select()
      .from(ssoConnections)
      .where(eq(ssoConnections.tenantId, tenantId));
    const settings = row ? this.open(row) : null;
    return {
      connection:
        row && settings
          ? {
              protocol: row.protocol,
              issuer: settings.protocol === 'oidc' ? settings.issuer : null,
              clientId: settings.protocol === 'oidc' ? settings.clientId : null,
              hasClientSecret: settings.protocol === 'oidc' && settings.clientSecret.length > 0,
              entryPoint: settings.protocol === 'saml' ? settings.entryPoint : null,
              idpIssuer: settings.protocol === 'saml' ? settings.idpIssuer : null,
              hasIdpCertificate: settings.protocol === 'saml',
              domains: row.domains,
              enabled: row.enabled,
              enforced: row.enforced,
              updatedAt: row.updatedAt.toISOString(),
            }
          : null,
      provider: this.urls(tenant.slug),
    };
  }

  /**
   * Saves a tenant's connection. An OIDC client secret left out keeps the one saved; a domain
   * another tenant's connection holds is refused, so an email always leads to one organisation.
   * Returns the settings before and after, without secrets, for the audit log.
   */
  async save(
    tenantId: string,
    body: SsoConnectionBody,
  ): Promise<{ before: unknown; after: unknown }> {
    await this.tenant(tenantId);
    return this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(ssoConnections)
        .where(eq(ssoConnections.tenantId, tenantId))
        .for('update');
      const previous = existing ? this.open(existing) : null;
      const settings: Stored =
        body.settings.protocol === 'oidc'
          ? {
              protocol: 'oidc',
              issuer: body.settings.issuer,
              clientId: body.settings.clientId,
              clientSecret:
                body.settings.clientSecret ??
                (previous?.protocol === 'oidc' ? previous.clientSecret : ''),
            }
          : {
              protocol: 'saml',
              entryPoint: body.settings.entryPoint,
              idpIssuer: body.settings.idpIssuer,
              idpCertificate:
                body.settings.idpCertificate ??
                (previous?.protocol === 'saml' ? previous.idpCertificate : ''),
            };
      if (settings.protocol === 'oidc' && !settings.clientSecret) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'settings.clientSecret', issue: 'Enter the client secret' },
        ]);
      }
      // The issuer is fetched from the cell, so in production it must be public (decision D101).
      const issuerIssue =
        settings.protocol === 'oidc' && this.config.NODE_ENV === 'production'
          ? await publicUrlIssue(settings.issuer)
          : null;
      if (issuerIssue) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'settings.issuer', issue: issuerIssue },
        ]);
      }
      if (settings.protocol === 'saml' && !settings.idpCertificate) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'settings.idpCertificate', issue: 'Paste the identity provider’s certificate' },
        ]);
      }
      const taken = await tx
        .select({ domains: ssoConnections.domains })
        .from(ssoConnections)
        .where(
          and(
            ne(ssoConnections.tenantId, tenantId),
            sql`${ssoConnections.domains} && ${sql.param(body.domains)}::text[]`,
          ),
        );
      const clash = body.domains.find((domain) =>
        taken.some((row) => row.domains.includes(domain)),
      );
      if (clash) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'domains', issue: `Another organisation signs in ${clash} already` },
        ]);
      }
      const values = {
        protocol: settings.protocol,
        configSealed: this.cipher.seal(JSON.stringify(settings), where(tenantId)),
        domains: body.domains,
        enabled: body.enabled,
        enforced: body.enforced,
        updatedAt: new Date(),
      };
      await tx
        .insert(ssoConnections)
        .values({ tenantId, ...values })
        .onConflictDoUpdate({ target: ssoConnections.tenantId, set: values });
      const shown = (
        stored: Stored | null,
        row?: { domains: string[]; enabled: boolean; enforced: boolean },
      ) =>
        stored && row
          ? {
              ...redact(stored),
              domains: row.domains,
              enabled: row.enabled,
              enforced: row.enforced,
            }
          : null;
      return { before: shown(previous, existing), after: shown(settings, body) };
    });
  }

  /** Where a work email signs in with SSO, or null; only connections that are on count. */
  async discover(email: string): Promise<string | null> {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return null;
    const [row] = await this.database.db
      .select({ slug: tenants.slug })
      .from(ssoConnections)
      .innerJoin(tenants, eq(tenants.id, ssoConnections.tenantId))
      .where(
        and(
          eq(ssoConnections.enabled, true),
          sql`${sql.param(domain)} = any(${ssoConnections.domains})`,
        ),
      );
    return row ? `/auth/v1/sso/${row.slug}/start` : null;
  }

  /** Sends the browser to the tenant's identity provider. */
  async start(slug: string): Promise<string> {
    const { tenantId, settings } = await this.usable(slug);
    const state = newSecret();
    const pending: Pending = { tenantId, protocol: settings.protocol };
    let url: string;
    if (settings.protocol === 'oidc') {
      const configuration = await this.discovery(settings);
      const verifier = oidc.randomPKCECodeVerifier();
      const nonce = oidc.randomNonce();
      url = oidc
        .buildAuthorizationUrl(configuration, {
          redirect_uri: this.urls(slug).redirectUri,
          scope: 'openid email profile',
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          state,
          nonce,
        })
        .toString();
      Object.assign(pending, { verifier, nonce });
    } else {
      url = await this.saml(slug, settings).getAuthorizeUrlAsync(state, undefined, {});
    }
    await this.client.redis.set(
      `sso:${digest(state)}`,
      JSON.stringify(pending),
      'EX',
      SSO_STATE_SECONDS,
    );
    return url;
  }

  /** The OIDC provider's answer: exchanges the code and signs the person in. */
  async oidcCallback(slug: string, url: URL, ip?: string): Promise<SignedIn> {
    const state = url.searchParams.get('state');
    if (url.searchParams.get('error')) throw new SsoRefused('refused');
    const pending = await this.pending(state, 'oidc');
    const { tenantId, settings, domains } = await this.usable(slug);
    if (pending.tenantId !== tenantId || settings.protocol !== 'oidc') {
      throw new SsoRefused('expired');
    }
    let email: string | undefined;
    try {
      const tokens = await oidc.authorizationCodeGrant(await this.discovery(settings), url, {
        pkceCodeVerifier: pending.verifier!,
        expectedState: state!,
        expectedNonce: pending.nonce!,
      });
      const claims = tokens.claims();
      if (claims?.email_verified === false) throw new SsoRefused('refused');
      email = typeof claims?.email === 'string' ? claims.email : undefined;
    } catch (error) {
      if (error instanceof SsoRefused) throw error;
      this.logger.warn(`OIDC sign-in for ${slug} failed: ${(error as Error).message}`);
      throw new SsoRefused('refused');
    }
    return this.signIn(tenantId, email, domains, ip);
  }

  /** The SAML provider's posted response: checks its signature and signs the person in. */
  async samlResponse(
    slug: string,
    body: { SAMLResponse?: string; RelayState?: string },
    ip?: string,
  ): Promise<SignedIn> {
    const pending = await this.pending(body.RelayState ?? null, 'saml');
    const { tenantId, settings, domains } = await this.usable(slug);
    if (pending.tenantId !== tenantId || settings.protocol !== 'saml' || !body.SAMLResponse) {
      throw new SsoRefused('expired');
    }
    let email: string | undefined;
    try {
      const { profile } = await this.saml(slug, settings).validatePostResponseAsync({
        SAMLResponse: body.SAMLResponse,
      });
      const candidates = [
        profile?.email,
        profile?.mail,
        profile?.['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
        profile?.nameID,
      ];
      email = candidates.find(
        (value): value is string => typeof value === 'string' && value.includes('@'),
      );
    } catch (error) {
      this.logger.warn(`SAML sign-in for ${slug} failed: ${(error as Error).message}`);
      throw new SsoRefused('refused');
    }
    return this.signIn(tenantId, email, domains, ip);
  }

  /** Our SAML service provider metadata, for the identity provider's admin. */
  async metadata(slug: string): Promise<string> {
    const [tenant] = await this.database.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug));
    if (!tenant) throw new AppError('NOT_FOUND', 'There is no such organisation.');
    const urls = this.urls(slug);
    return new SAML({
      entryPoint: urls.acsUrl,
      issuer: urls.entityId,
      callbackUrl: urls.acsUrl,
      idpCert: 'unused',
    }).generateServiceProviderMetadata(null, null);
  }

  private async signIn(
    tenantId: string,
    email: string | undefined,
    domains: string[],
    ip: string | undefined,
  ): Promise<SignedIn> {
    const domain = email?.split('@')[1]?.toLowerCase();
    if (!email || !domain || !domains.includes(domain)) throw new SsoRefused('domain');
    const userId = await this.emails.find(tenantId, email);
    if (!userId) throw new SsoRefused('no_person');
    const [membership] = await activeMemberships(
      this.database.db,
      and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)),
    );
    if (!membership) throw new SsoRefused('no_person');
    try {
      return await this.sessions.ssoSignIn(membership, ip);
    } catch (error) {
      if (error instanceof AppError) throw new SsoRefused('refused');
      throw error;
    }
  }

  /** A pending sign-in by its state, spent once. */
  private async pending(state: string | null, protocol: Pending['protocol']): Promise<Pending> {
    if (!state) throw new SsoRefused('expired');
    const held = await this.client.redis.getdel(`sso:${digest(state)}`);
    if (!held) throw new SsoRefused('expired');
    const pending = JSON.parse(held) as Pending;
    if (pending.protocol !== protocol) throw new SsoRefused('expired');
    return pending;
  }

  /** A tenant's connection when it is on and the tenant's plan includes SSO. */
  private async usable(slug: string) {
    const [row] = await this.database.db
      .select({ tenantId: tenants.id, connection: ssoConnections })
      .from(tenants)
      .innerJoin(ssoConnections, eq(ssoConnections.tenantId, tenants.id))
      .where(eq(tenants.slug, slug));
    if (!row || !row.connection.enabled) throw new SsoRefused('unavailable');
    const { modules } = await this.entitlements.forTenant(row.tenantId);
    if (modules && !modules.includes('sso')) throw new SsoRefused('unavailable');
    const settings = this.open(row.connection);
    if (!settings) throw new SsoRefused('unavailable');
    return { tenantId: row.tenantId, settings, domains: row.connection.domains };
  }

  private async tenant(tenantId: string) {
    const [tenant] = await this.database.db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) throw new AppError('NOT_FOUND', 'There is no such organisation.');
    return tenant;
  }

  private open(row: { tenantId: string; configSealed: string }): Stored | null {
    try {
      return JSON.parse(this.cipher.open(row.configSealed, where(row.tenantId))) as Stored;
    } catch {
      return null;
    }
  }

  private discovery(settings: Extract<Stored, { protocol: 'oidc' }>) {
    // In production every call to the identity provider goes to a public address, connected to
    // as checked (decision D101); off production, plain HTTP for a local or test provider.
    const production = this.config.NODE_ENV === 'production';
    return oidc.discovery(
      new URL(settings.issuer),
      settings.clientId,
      settings.clientSecret,
      undefined,
      production
        ? { [oidc.customFetch]: publicFetch as oidc.CustomFetch }
        : { execute: [oidc.allowInsecureRequests] },
    );
  }

  private saml(slug: string, settings: Extract<Stored, { protocol: 'saml' }>) {
    const urls = this.urls(slug);
    return new SAML({
      entryPoint: settings.entryPoint,
      issuer: urls.entityId,
      callbackUrl: urls.acsUrl,
      audience: urls.entityId,
      idpCert: settings.idpCertificate,
      idpIssuer: settings.idpIssuer,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
    });
  }
}

/** The context a sealed connection belongs to: its column and its row. */
function where(tenantId: string): string {
  return `sso_connections.config_sealed:${tenantId}`;
}

/** Settings as the audit log keeps them: never a secret. */
function redact(settings: Stored): Partial<SsoSettings> {
  return settings.protocol === 'oidc'
    ? { protocol: 'oidc', issuer: settings.issuer, clientId: settings.clientId }
    : { protocol: 'saml', entryPoint: settings.entryPoint, idpIssuer: settings.idpIssuer };
}
