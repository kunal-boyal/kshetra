import { z } from 'zod';
import { API_SCOPE_KEYS } from '../api-clients';

/** API clients (module M20, decision D94), as tenant admins manage them and the token endpoint answers. */

export const ApiScope = z.enum(API_SCOPE_KEYS);

/** `POST /v1/api-clients`: made under the portal's own ID; the secret comes back once. */
export const CreateApiClientBody = z
  .strictObject({
    id: z.uuid(),
    name: z.string().trim().min(1).max(80),
    scopes: z
      .array(ApiScope)
      .min(1)
      .refine((scopes) => new Set(scopes).size === scopes.length, 'List each scope once'),
  })
  .meta({ id: 'CreateApiClientBody' });

export const ApiClientResult = z
  .object({
    id: z.uuid(),
    name: z.string(),
    /** Public: it names the client to the token endpoint. */
    clientId: z.string(),
    scopes: z.array(ApiScope),
    status: z.enum(['active', 'revoked']),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime().nullable(),
    revokedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'ApiClient' });

export const ApiClientList = z.object({ items: z.array(ApiClientResult) });

/** A client with its secret, shown only now: on creating it, or on rotating the secret. */
export const ApiClientSecret = z
  .object({ client: ApiClientResult, clientSecret: z.string() })
  .meta({ id: 'ApiClientSecret' });

/**
 * `POST /auth/v1/oauth/token` (RFC 6749, section 4.4): the client credentials grant. The
 * credentials come in the body or as HTTP Basic; `scope` may narrow what the token holds.
 */
export const OAuthTokenBody = z.object({
  grant_type: z.string(),
  client_id: z.string().max(200).optional(),
  client_secret: z.string().max(200).optional(),
  scope: z.string().max(1000).optional(),
});

export const OAuthTokenResult = z
  .object({
    access_token: z.string(),
    token_type: z.literal('Bearer'),
    expires_in: z.int(),
    scope: z.string(),
  })
  .meta({ id: 'OAuthToken' });

/** An OAuth error, in RFC 6749's own shape, which integrators' libraries expect. */
export const OAuthError = z
  .object({ error: z.string(), error_description: z.string().optional() })
  .meta({ id: 'OAuthError' });

export type CreateApiClientBody = z.output<typeof CreateApiClientBody>;
export type ApiClientResult = z.infer<typeof ApiClientResult>;
