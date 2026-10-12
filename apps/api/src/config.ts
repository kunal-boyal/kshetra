import { APP_VERSION } from '@kshetra/shared';
import { z } from 'zod';

// A store version such as 1.4.0; an empty value in .env counts as unset.
const minimumVersion = z
  .string()
  .optional()
  .transform((value) => value || undefined)
  .pipe(z.string().regex(APP_VERSION, 'Use a version such as 1.4.0').optional());

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
    // Web origins allowed to call this API from a browser, comma-separated (spec 13.1). Empty
    // allows none; locally the web app proxies through its own origin and needs none.
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((list) =>
        list
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(
          z.url().regex(/^https?:\/\/[^/]+$/, 'Use an origin, such as https://app.example.com'),
        ),
      ),
    // This deployment's cell. Access tokens name it, and a cell refuses tokens for another.
    CELL_ID: z.string().min(1).default('local'),
    // Where apps reach this cell, as the directory hands it out at sign-in, and its region.
    // Provisioning registers the cell with these; production must set the URL.
    CELL_API_URL: z.url().optional(),
    CELL_REGION: z.string().min(1).default('local'),
    // The oldest app version each platform may still use (M1, rule 8). An older app gets
    // UPGRADE_REQUIRED and shows its blocking update screen. Unset lets every version in.
    MIN_APP_VERSION_ANDROID: minimumVersion,
    MIN_APP_VERSION_IOS: minimumVersion,
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
    // Whether this process runs the outbox relay, which retries events whose delivery failed. The
    // worker process turns it on; elsewhere it stays off unless set.
    OUTBOX_RELAY: z.stringbool().default(false),
    OUTBOX_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    // How often the scheduler looks for tenants whose local time has reached scheduled work.
    SCHEDULER_TICK_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
    // Every sync cursor carries this value, and a cursor with another one is refused with
    // SYNC_RESET. Raise it after restoring or moving the cell's database: every phone then takes
    // a full copy of its data (decision D40).
    SYNC_EPOCH: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .default('1'),
    // Where files live (spec 12.2): `s3` is Amazon S3, or MinIO locally; `memory` is for tests.
    OBJECT_STORE: z.enum(['s3', 'memory']).default('s3'),
    S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .optional(),
    S3_REGION: z.string().min(1).default('ap-south-1'),
    // MinIO's address locally; unset in AWS, where the SDK finds S3 itself.
    S3_ENDPOINT: z.url().optional(),
    // MinIO's user and password locally; unset in AWS, where the task's role signs requests.
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
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
      if (!config.CELL_API_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['CELL_API_URL'],
          message: 'Production needs the URL apps reach this cell at.',
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
    if (config.OBJECT_STORE === 's3' && !config.S3_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'Name the bucket files go in.',
      });
    }
    if (config.OBJECT_STORE === 'memory' && config.NODE_ENV !== 'test') {
      ctx.addIssue({
        code: 'custom',
        path: ['OBJECT_STORE'],
        message: 'The memory store is for tests only.',
      });
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
