import { z } from 'zod';

/**
 * Single sign-on for web users (spec M1, D5, decision D91): one connection a tenant, to its own
 * identity provider through OIDC or SAML, for the email domains it names. People are matched by
 * email, never created. Required, it refuses web OTP to people in those domains.
 */

export const SSO_PROTOCOLS = ['oidc', 'saml'] as const;
export type SsoProtocol = (typeof SSO_PROTOCOLS)[number];

/** An email domain, such as sunrise-agro.example. */
export const EmailDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'Enter a domain such as example.com',
  );

const OidcSettings = z.strictObject({
  protocol: z.literal('oidc'),
  /** The provider's issuer, whose `.well-known/openid-configuration` describes it. */
  issuer: z.url(),
  clientId: z.string().trim().min(1).max(200),
  /** Left out when changing other settings, to keep the one saved. */
  clientSecret: z.string().min(1).max(500).optional(),
});

const SamlSettings = z.strictObject({
  protocol: z.literal('saml'),
  /** Where the provider takes sign-in requests. */
  entryPoint: z.url(),
  /** The provider's entity ID, which its responses must name. */
  idpIssuer: z.string().trim().min(1).max(500),
  /** The provider's signing certificate, as PEM or bare base64. */
  /** Left out when changing other settings, to keep the one saved. */
  idpCertificate: z.string().trim().min(100).max(20_000).optional(),
});

export const SsoSettings = z.discriminatedUnion('protocol', [OidcSettings, SamlSettings]);

/** `PUT /v1/sso`: the tenant's connection, as its admin sets it. */
export const SsoConnectionBody = z
  .strictObject({
    settings: SsoSettings,
    domains: z
      .array(EmailDomain)
      .min(1)
      .max(20)
      .refine((domains) => new Set(domains).size === domains.length, 'List each domain once'),
    enabled: z.boolean(),
    /** Web users in these domains must use SSO; phones keep OTP. */
    enforced: z.boolean(),
  })
  .refine((body) => body.enabled || !body.enforced, {
    path: ['enforced'],
    message: 'Turn the connection on before requiring it',
  })
  .meta({ id: 'SsoConnectionBody' });

export const SsoConnectionResult = z
  .object({
    connection: z
      .object({
        protocol: z.enum(SSO_PROTOCOLS),
        /** OIDC */
        issuer: z.string().nullable(),
        clientId: z.string().nullable(),
        hasClientSecret: z.boolean(),
        /** SAML */
        entryPoint: z.string().nullable(),
        idpIssuer: z.string().nullable(),
        hasIdpCertificate: z.boolean(),
        domains: z.array(z.string()),
        /**
         * Each domain's proof (decision D101): the TXT record to publish, and whether it has been
         * found. Only verified domains sign anyone in.
         */
        domainChecks: z.array(
          z.object({
            domain: z.string(),
            verified: z.boolean(),
            recordName: z.string(),
            recordValue: z.string(),
          }),
        ),
        enabled: z.boolean(),
        enforced: z.boolean(),
        updatedAt: z.iso.datetime(),
      })
      .nullable(),
    /** What the identity provider needs from us, for its admin to register the product. */
    provider: z.object({
      /** OIDC: where the provider sends people back. */
      redirectUri: z.string(),
      /** SAML: our entity ID, our assertion consumer URL, and our metadata. */
      entityId: z.string(),
      acsUrl: z.string(),
      metadataUrl: z.string(),
    }),
  })
  .meta({ id: 'SsoConnection' });

/** `POST /auth/v1/sso/discover`: whether a work email signs in through its organisation's SSO. */
export const SsoDiscoverBody = z.strictObject({ email: z.email() });
export const SsoDiscoverResult = z.object({
  /** Where to send the browser to sign in with SSO; null when the email's domain has none. */
  url: z.string().nullable(),
});

/** Why an SSO sign-in came back to the sign-in page, as its `sso` query parameter says. */
export const SSO_FAILURES = ['expired', 'refused', 'domain', 'no_person', 'unavailable'] as const;
export type SsoFailure = (typeof SSO_FAILURES)[number];

export type SsoConnectionBody = z.output<typeof SsoConnectionBody>;
export type SsoConnectionResult = z.infer<typeof SsoConnectionResult>;
export type SsoSettings = z.output<typeof SsoSettings>;

/** `POST /v1/sso/domains/verify`: look for one domain's TXT record now. */
export const SsoDomainVerifyBody = z.strictObject({ domain: z.string().min(3).max(253) });
