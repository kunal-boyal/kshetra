import { z } from 'zod';

/** The API's settings (spec Appendix F). Production values come from Secrets Manager or the task definition. */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Every product name and identifier derives from this one value (spec 0).
    PRODUCT_SLUG: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,30}$/)
      .default('kshetra'),
    // 127.0.0.1 locally; containers set 0.0.0.0, and so does phone testing on the local network.
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // Behind a load balancer, trust its X-Forwarded-For so rate limits see the caller's address.
    TRUST_PROXY: z.stringbool().default(false),
    // This deployment's cell. Access tokens name it, and a cell refuses tokens for another.
    CELL_ID: z.string().min(1).default('local'),
    DATABASE_URL: z.url(),
    // The directory module's own role (decision D23); phases 0 to 2 run it inside the API.
    DIRECTORY_DATABASE_URL: z.url(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.url(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    // `console` prints codes locally; `memory` keeps them for tests. Production uses a real sender.
    OTP_PROVIDER: z.enum(['console', 'memory']).default('console'),
    // The secret one-time codes are hashed with (spec M1, rule 3).
    OTP_PEPPER: z.string().min(16),
    // PKCS8 PEM of the P-256 key that signs access tokens (ES256), with newlines written as \n.
    // Left unset outside production, the API makes a temporary key at start-up.
    JWT_SIGNING_KEY: z
      .string()
      .optional()
      .transform((pem) => (pem ? pem.replace(/\\n/g, '\n') : undefined)),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === 'production') {
      if (config.OTP_PROVIDER === 'console' || config.OTP_PROVIDER === 'memory') {
        ctx.addIssue({
          code: 'custom',
          path: ['OTP_PROVIDER'],
          message: `The ${config.OTP_PROVIDER} provider never sends a real code; production needs a real one.`,
        });
      }
      if (!config.JWT_SIGNING_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_SIGNING_KEY'],
          message: 'Production needs a signing key that survives restarts.',
        });
      }
      if (config.OTP_PEPPER.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['OTP_PEPPER'],
          message: 'Use at least 32 characters in production.',
        });
      }
    }
    if (config.OTP_PROVIDER === 'memory' && config.NODE_ENV !== 'test') {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_PROVIDER'],
        message: 'The memory provider is for tests only.',
      });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
