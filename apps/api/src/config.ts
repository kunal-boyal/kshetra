import { APP_VERSION, normalisePhone } from '@thelamp/shared';
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
      .default('thelamp'),
    // The product's name where people read it, such as on a photo's stamp (decision D1).
    PRODUCT_NAME: z.string().trim().min(1).max(40).default('The Lamp'),
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
    // The Redis key prefix of the job queues; tests give each process its own, so one test file's
    // workers never take another's jobs.
    QUEUE_PREFIX: z
      .string()
      .regex(/^[A-Za-z0-9:_-]{1,64}$/)
      .optional(),
    // `console` prints codes locally; `mailpit` mails them to the local inbox, where Maestro reads
    // them (decision D68); `memory` keeps them for tests. Production sends them by MSG91 (D67).
    // `none` sends nothing, for a demo cell whose people sign in with DEMO_CODES (decision D70).
    OTP_PROVIDER: z.enum(['msg91', 'console', 'mailpit', 'memory', 'none']).default('console'),
    // What the cell is for (decision D70). A `demo` cell shows the product to prospects: it may run
    // without SMS, email or push providers, printing those messages with numbers masked instead.
    CELL_PURPOSE: z.enum(['live', 'demo']).default('live'),
    // Fixed sign-in codes for named numbers, as JSON: {"+919800000001": "482913"} (decision D70).
    // They work only for people whose every tenant is a demo tenant, so a leaked code opens no
    // real tenant. Keep it in the cell's secret, never in the repository.
    DEMO_CODES: z
      .string()
      .default('{}')
      .transform((text, ctx) => {
        let entries: [string, unknown][];
        try {
          const parsed: unknown = JSON.parse(text);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw 0;
          entries = Object.entries(parsed);
        } catch {
          ctx.addIssue({ code: 'custom', message: 'Use JSON: {"<number>": "<six digits>"}' });
          return z.NEVER;
        }
        const codes = new Map<string, string>();
        for (const [number, code] of entries) {
          const phone = normalisePhone(number);
          if (!phone) {
            ctx.addIssue({
              code: 'custom',
              message: 'A demo number is not a valid mobile number.',
            });
            return z.NEVER;
          }
          if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
            ctx.addIssue({ code: 'custom', message: 'Each demo code is six digits.' });
            return z.NEVER;
          }
          codes.set(phone, code);
        }
        return codes;
      }),
    // How notifications leave the cell (M16, decision D58). `console` prints them locally and
    // `memory` keeps them for tests; production needs real ones.
    PUSH_PROVIDER: z.enum(['expo', 'console', 'memory']).default('console'),
    // An Expo access token, when the project's push security is on.
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
    SMS_PROVIDER: z.enum(['msg91', 'console', 'memory']).default('console'),
    // MSG91 (decision D67): every SMS goes through a DLT-registered template.
    MSG91_AUTH_KEY: z.string().min(1).optional(),
    MSG91_BASE_URL: z.url().default('https://control.msg91.com'),
    // The DLT sender ID; left unset, each template's own sender is used.
    MSG91_SENDER: z
      .string()
      .regex(/^[A-Z]{6}$/)
      .optional(),
    MSG91_OTP_TEMPLATE_ID: z.string().min(1).optional(),
    // The name of the code's variable in the OTP template.
    MSG91_OTP_VARIABLE: z.string().min(1).default('otp'),
    // Templates for SMS notifications by event and language, as JSON:
    // {"visit.missed": {"en": "<template id>", "hi": "<template id>"}}. An event without one goes
    // to the next channel instead.
    MSG91_SMS_TEMPLATES: z
      .string()
      .default('{}')
      .transform((text, ctx) => {
        try {
          return z
            .record(z.string(), z.record(z.string(), z.string().min(1)))
            .parse(JSON.parse(text));
        } catch {
          ctx.addIssue({
            code: 'custom',
            message: 'Use JSON: {"<event>": {"en": "<template id>", "hi": "<template id>"}}',
          });
          return z.NEVER;
        }
      }),
    // WhatsApp (decision D85): `off` until a provider account exists (D12), when deliveries skip
    // to the next channel; `console` prints locally and `memory` keeps them for tests.
    WHATSAPP_PROVIDER: z.enum(['off', 'console', 'memory']).default('off'),
    // The provider's key and sending number, once its account exists.
    WHATSAPP_API_KEY: z.string().min(1).optional(),
    WHATSAPP_SENDER_ID: z.string().min(1).optional(),
    // The provider-approved templates notifications go out in, by event and language, as JSON:
    // {"plan.today": {"en": "<template name>", "hi": "<template name>"}}. An event without one goes
    // to the next channel instead.
    WHATSAPP_TEMPLATES: z
      .string()
      .default('{}')
      .transform((text, ctx) => {
        try {
          return z
            .record(z.string(), z.record(z.string(), z.string().min(1)))
            .parse(JSON.parse(text));
        } catch {
          ctx.addIssue({
            code: 'custom',
            message: 'Use JSON: {"<event>": {"en": "<template name>", "hi": "<template name>"}}',
          });
          return z.NEVER;
        }
      }),
    EMAIL_PROVIDER: z.enum(['smtp', 'console', 'memory']).default('smtp'),
    // Mailpit locally; Amazon SES's SMTP endpoint in AWS.
    SMTP_URL: z.url().default('smtp://127.0.0.1:1025'),
    MAIL_FROM: z.string().min(3).optional(),
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
    // Photos are read through CloudFront signed URLs in AWS (spec 12.2); without these three,
    // as locally, reads are presigned by the object store itself.
    CLOUDFRONT_DOMAIN: z.string().min(1).optional(),
    CLOUDFRONT_KEY_ID: z.string().min(1).optional(),
    CLOUDFRONT_PRIVATE_KEY: z
      .string()
      .optional()
      .transform((pem) => (pem ? pem.replace(/\\n/g, '\n') : undefined)),
    // PKCS8 PEM of the P-256 key that signs access tokens (ES256), with newlines written as \n.
    // Left unset outside production, the API makes a temporary key at start-up.
    JWT_SIGNING_KEY: z
      .string()
      .optional()
      .transform((pem) => (pem ? pem.replace(/\\n/g, '\n') : undefined)),
  })
  .superRefine((config, ctx) => {
    if (config.OTP_PROVIDER === 'none' && config.CELL_PURPOSE !== 'demo') {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_PROVIDER'],
        message: 'Only a demo cell may send no codes.',
      });
    }
    if (config.NODE_ENV === 'production') {
      if (['console', 'mailpit', 'memory'].includes(config.OTP_PROVIDER)) {
        ctx.addIssue({
          code: 'custom',
          path: ['OTP_PROVIDER'],
          message: `The ${config.OTP_PROVIDER} provider never sends a real code; production needs a real one.`,
        });
      }
      for (const [key, value] of [
        ['PUSH_PROVIDER', config.PUSH_PROVIDER],
        ['SMS_PROVIDER', config.SMS_PROVIDER],
        ['EMAIL_PROVIDER', config.EMAIL_PROVIDER],
        ['WHATSAPP_PROVIDER', config.WHATSAPP_PROVIDER],
      ] as const) {
        if (value === 'memory' || (value === 'console' && config.CELL_PURPOSE !== 'demo')) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `The ${value} provider never delivers; production needs a real one.`,
          });
        }
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
    if (
      (config.OTP_PROVIDER === 'msg91' || config.SMS_PROVIDER === 'msg91') &&
      !config.MSG91_AUTH_KEY
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['MSG91_AUTH_KEY'],
        message: 'MSG91 needs its auth key.',
      });
    }
    if (config.OTP_PROVIDER === 'msg91' && !config.MSG91_OTP_TEMPLATE_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['MSG91_OTP_TEMPLATE_ID'],
        message: 'Name the DLT template one-time codes go out in.',
      });
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
    for (const [key, value] of [
      ['PUSH_PROVIDER', config.PUSH_PROVIDER],
      ['SMS_PROVIDER', config.SMS_PROVIDER],
      ['EMAIL_PROVIDER', config.EMAIL_PROVIDER],
      ['WHATSAPP_PROVIDER', config.WHATSAPP_PROVIDER],
    ] as const) {
      if (value === 'memory' && config.NODE_ENV !== 'test') {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'The memory provider is for tests only.',
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
