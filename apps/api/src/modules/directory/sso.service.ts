import { Inject, Injectable, Logger } from '@nestjs/common';
import { type CacheProvider, SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import {
  AppError,
  providerUsedMfa,
  type SecondFactor,
  type SignedIn,
  type SsoConnectionBody,
  type SsoConnectionResult,
  type SsoFailure,
  type SsoSettings,
} from '@thelamp/shared';
import { randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, ne, notInArray } from 'drizzle-orm';
import * as oidc from 'openid-client';
import type { Config } from '../../config';
import {
  memberships,
  ssoConnections,
  ssoDomains,
  ssoSubjects,
  tenants,
} from '../../db/schema/directory';
import { ColumnCipher } from '../../platform/column-cipher';
import { DomainRecords } from '../../platform/domain-records';
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

/** A domain's proof token: what its TXT record must hold (decision D101). */
const domainToken = () => randomBytes(16).toString('hex');

type Stored =
  | { protocol: 'oidc'; issuer: string; clientId: string; clientSecret: string }
  | { protocol: 'saml'; entryPoint: string; idpIssuer: string; idpCertificate: string };

/** Who the provider says someone is: its issuer, and their subject there (decision D101). */
interface ProviderSubject {
  issuer: string;
  subject: string;
}

interface Pending {
  tenantId: string;
  protocol: 'oidc' | 'saml';
  /** The digest of the binder the starting browser holds in a cookie (decision D101). */
  binder: string;
  verifier?: string;
  nonce?: string;
}

/** A sign-in started: where the browser goes, and the binder it keeps until it comes back. */
export interface SsoStart {
  url: string;
  binder: string;
}

/** SHA-1 in a SAML response's signature or digest, which is refused before checking (D101). */
const SHA1 = /Algorithm="[^"]*(?:rsa-sha1|dsa-sha1|#sha1)"/i;

/**
 * The SAML requests we sent, kept until their response comes back, so `InResponseTo` must name
 * one and each answers once: a response captured on its way can't be replayed (decision D101).
 */
class SamlRequests implements CacheProvider {
  constructor(private readonly redis: RedisClient) {}

  async saveAsync(key: string, value: string) {
    const createdAt = Date.now();
    await this.redis.redis.set(`saml-request:${key}`, value, 'EX', SSO_STATE_SECONDS);
    return { value, createdAt };
  }

  async getAsync(key: string) {
    return this.redis.redis.get(`saml-request:${key}`);
  }

  async removeAsync(key: string | null) {
    return key ? this.redis.redis.getdel(`saml-request:${key}`) : null;
  }
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
    private readonly records: DomainRecords,
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
              domainChecks: await this.domainChecks(tenantId),
              enabled: row.enabled,
              enforced: row.enforced,
              updatedAt: row.updatedAt.toISOString(),
            }
          : null,
      provider: this.urls(tenant.slug),
    };
  }

  /** Where a domain's proof is published, and what it says (decision D101). */
  private record(domain: string, token: string) {
    const slug = this.config.PRODUCT_SLUG;
    return { recordName: `_${slug}-sso.${domain}`, recordValue: `${slug}-sso=${token}` };
  }

  private async domainChecks(tenantId: string) {
    const rows = await this.database.db
      .select()
      .from(ssoDomains)
      .where(eq(ssoDomains.tenantId, tenantId))
      .orderBy(asc(ssoDomains.domain));
    return rows.map((row) => ({
      domain: row.domain,
      verified: row.verifiedAt !== null,
      ...this.record(row.domain, row.token),
    }));
  }

  /**
   * Looks for a domain's TXT record now, and marks the domain verified when it holds the token
   * (ASVS V6.8.1, decision D101). A domain another organisation verified first stays theirs.
   */
  async verifyDomain(tenantId: string, domain: string): Promise<void> {
    const wanted = domain.toLowerCase();
    const [row] = await this.database.db
      .select()
      .from(ssoDomains)
      .where(and(eq(ssoDomains.tenantId, tenantId), eq(ssoDomains.domain, wanted)));
    if (!row) throw new AppError('NOT_FOUND', 'This domain isn’t part of your single sign-on.');
    if (row.verifiedAt) return;
    const { recordName, recordValue } = this.record(row.domain, row.token);
    const values = await this.records.txt(recordName);
    if (!values.some((value) => value.trim() === recordValue)) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [
        { path: 'domain', issue: `No TXT record with the token was found at ${recordName} yet` },
      ]);
    }
    try {
      await this.database.db
        .update(ssoDomains)
        .set({ verifiedAt: new Date() })
        .where(and(eq(ssoDomains.tenantId, tenantId), eq(ssoDomains.domain, wanted)));
    } catch {
      throw new AppError('CONFLICT', 'Another organisation has verified this domain already.');
    }
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
      // Only a domain another organisation has proved is theirs is refused; an unproved claim
      // never blocks the domain's real owner (decision D101).
      const [taken] = await tx
        .select({ domain: ssoDomains.domain })
        .from(ssoDomains)
        .where(
          and(
            ne(ssoDomains.tenantId, tenantId),
            inArray(ssoDomains.domain, body.domains),
            isNotNull(ssoDomains.verifiedAt),
          ),
        )
        .limit(1);
      if (taken) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'domains', issue: `Another organisation signs in ${taken.domain} already` },
        ]);
      }
      // Each domain keeps its token and proof while it stays; one taken out goes.
      await tx
        .delete(ssoDomains)
        .where(and(eq(ssoDomains.tenantId, tenantId), notInArray(ssoDomains.domain, body.domains)));
      if (body.domains.length > 0) {
        await tx
          .insert(ssoDomains)
          .values(body.domains.map((domain) => ({ tenantId, domain, token: domainToken() })))
          .onConflictDoNothing();
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
      .from(ssoDomains)
      .innerJoin(ssoConnections, eq(ssoConnections.tenantId, ssoDomains.tenantId))
      .innerJoin(tenants, eq(tenants.id, ssoDomains.tenantId))
      .where(
        and(
          eq(ssoConnections.enabled, true),
          eq(ssoDomains.domain, domain),
          isNotNull(ssoDomains.verifiedAt),
        ),
      );
    return row ? `/auth/v1/sso/${row.slug}/start` : null;
  }

  /**
   * Sends the browser to the tenant's identity provider, with a binder for a cookie: the answer
   * counts only in the browser that started, so nobody can sign a victim's browser into another
   * account by sending it a sign-in of their own (decision D101).
   */
  async start(slug: string): Promise<SsoStart> {
    const { tenantId, settings } = await this.usable(slug);
    const state = newSecret();
    const binder = newSecret();
    const pending: Pending = { tenantId, protocol: settings.protocol, binder: digest(binder) };
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
    return { url, binder };
  }

  /** The OIDC provider's answer: exchanges the code and signs the person in. */
  async oidcCallback(
    slug: string,
    url: URL,
    binder: string | undefined,
    ip?: string,
  ): Promise<SignedIn | SecondFactor> {
    const state = url.searchParams.get('state');
    if (url.searchParams.get('error')) throw new SsoRefused('refused');
    const pending = await this.pending(state, 'oidc', binder);
    const { tenantId, settings, domains } = await this.usable(slug);
    if (pending.tenantId !== tenantId || settings.protocol !== 'oidc') {
      throw new SsoRefused('expired');
    }
    let email: string | undefined;
    let mfa: boolean;
    let who: ProviderSubject | undefined;
    try {
      const tokens = await oidc.authorizationCodeGrant(await this.discovery(settings), url, {
        pkceCodeVerifier: pending.verifier!,
        expectedState: state!,
        expectedNonce: pending.nonce!,
      });
      const claims = tokens.claims();
      // An address the provider hasn't verified can't name a person here (decision D101).
      if (claims?.email_verified === false) throw new SsoRefused('refused');
      email = typeof claims?.email === 'string' ? claims.email : undefined;
      mfa = providerUsedMfa({ amr: claims?.amr, acr: claims?.acr });
      who = claims ? { issuer: String(claims.iss), subject: String(claims.sub) } : undefined;
    } catch (error) {
      if (error instanceof SsoRefused) throw error;
      this.logger.warn(`OIDC sign-in for ${slug} failed: ${(error as Error).message}`);
      throw new SsoRefused('refused');
    }
    return this.signIn(tenantId, email, domains, ip, mfa, who);
  }

  /** The SAML provider's posted response: checks its signature and signs the person in. */
  async samlResponse(
    slug: string,
    body: { SAMLResponse?: string; RelayState?: string },
    binder: string | undefined,
    ip?: string,
  ): Promise<SignedIn | SecondFactor> {
    const pending = await this.pending(body.RelayState ?? null, 'saml', binder);
    const { tenantId, settings, domains } = await this.usable(slug);
    if (pending.tenantId !== tenantId || settings.protocol !== 'saml' || !body.SAMLResponse) {
      throw new SsoRefused('expired');
    }
    if (SHA1.test(Buffer.from(body.SAMLResponse, 'base64').toString('utf8'))) {
      this.logger.warn(`SAML sign-in for ${slug} refused: it is signed with SHA-1`);
      throw new SsoRefused('refused');
    }
    let email: string | undefined;
    let mfa: boolean;
    let who: ProviderSubject | undefined;
    try {
      const { profile } = await this.saml(slug, settings).validatePostResponseAsync({
        SAMLResponse: body.SAMLResponse,
      });
      const assertion = profile?.getAssertionXml?.() ?? '';
      const methods = profile?.['http://schemas.microsoft.com/claims/authnmethodsreferences'];
      mfa = providerUsedMfa({
        authnContext: [
          ...[...assertion.matchAll(/<(?:\w+:)?AuthnContextClassRef>([^<]+)</g)].map(
            (match) => match[1]!,
          ),
          ...(Array.isArray(methods) ? methods.map(String) : methods ? [String(methods)] : []),
        ],
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
      who =
        profile?.issuer && profile.nameID
          ? { issuer: String(profile.issuer), subject: String(profile.nameID) }
          : undefined;
    } catch (error) {
      this.logger.warn(`SAML sign-in for ${slug} failed: ${(error as Error).message}`);
      throw new SsoRefused('refused');
    }
    return this.signIn(tenantId, email, domains, ip, mfa, who);
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

  /**
   * Signs in whoever the provider vouched for (decision D101): the member bound to its issuer and
   * subject, or, the first time, the member whose email it gave in a verified domain, who is then
   * bound to it. A member bound to another subject of the same provider isn't taken over.
   */
  private async signIn(
    tenantId: string,
    email: string | undefined,
    domains: string[],
    ip: string | undefined,
    mfa: boolean,
    who: ProviderSubject | undefined,
  ): Promise<SignedIn | SecondFactor> {
    if (!who) throw new SsoRefused('refused');
    const membership = await this.boundMember(tenantId, who, email, domains);
    try {
      return await this.sessions.ssoSignIn(membership, ip, mfa);
    } catch (error) {
      if (error instanceof AppError) throw new SsoRefused('refused');
      throw error;
    }
  }

  private async boundMember(
    tenantId: string,
    who: ProviderSubject,
    email: string | undefined,
    domains: string[],
  ) {
    const [bound] = await this.database.db
      .select({ membershipId: ssoSubjects.membershipId })
      .from(ssoSubjects)
      .where(
        and(
          eq(ssoSubjects.tenantId, tenantId),
          eq(ssoSubjects.issuer, who.issuer),
          eq(ssoSubjects.subject, who.subject),
        ),
      );
    if (bound) {
      const [membership] = await activeMemberships(
        this.database.db,
        eq(memberships.id, bound.membershipId),
      );
      if (!membership) throw new SsoRefused('no_person');
      return membership;
    }
    const domain = email?.split('@')[1]?.toLowerCase();
    if (!email || !domain || !domains.includes(domain)) throw new SsoRefused('domain');
    const userId = await this.emails.find(tenantId, email);
    if (!userId) throw new SsoRefused('no_person');
    const [membership] = await activeMemberships(
      this.database.db,
      and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)),
    );
    if (!membership) throw new SsoRefused('no_person');
    // Bound to another subject of this provider already: an email moved at the provider doesn't
    // move the person here.
    const inserted = await this.database.db
      .insert(ssoSubjects)
      .values({
        tenantId,
        issuer: who.issuer,
        subject: who.subject,
        membershipId: membership.membershipId,
      })
      .onConflictDoNothing()
      .returning({ membershipId: ssoSubjects.membershipId });
    if (inserted.length === 0) throw new SsoRefused('no_person');
    return membership;
  }

  /** A pending sign-in by its state, spent once, in the browser that started it. */
  private async pending(
    state: string | null,
    protocol: Pending['protocol'],
    binder: string | undefined,
  ): Promise<Pending> {
    if (!state) throw new SsoRefused('expired');
    const held = await this.client.redis.getdel(`sso:${digest(state)}`);
    if (!held) throw new SsoRefused('expired');
    const pending = JSON.parse(held) as Pending;
    if (pending.protocol !== protocol) throw new SsoRefused('expired');
    if (!binder || digest(binder) !== pending.binder) throw new SsoRefused('expired');
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
    // Only domains the organisation has proved are its own sign anyone in (decision D101).
    const verified = await this.database.db
      .select({ domain: ssoDomains.domain })
      .from(ssoDomains)
      .where(and(eq(ssoDomains.tenantId, row.tenantId), isNotNull(ssoDomains.verifiedAt)));
    return { tenantId: row.tenantId, settings, domains: verified.map((each) => each.domain) };
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
    // The ID token's signature is checked against the provider's keys, not taken on TLS alone
    // (decision D101).
    return oidc.discovery(
      new URL(settings.issuer),
      settings.clientId,
      settings.clientSecret,
      undefined,
      production
        ? {
            [oidc.customFetch]: publicFetch as oidc.CustomFetch,
            execute: [oidc.enableNonRepudiationChecks],
          }
        : { execute: [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks] },
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
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: SSO_STATE_SECONDS * 1000,
      cacheProvider: new SamlRequests(this.client),
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
