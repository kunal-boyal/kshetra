// A vendor staff member made for one run of the comparison, so the console can be screenshotted
// signed in (phase U, stage U12). `pnpm invite-staff` invites them on the local directory; the
// setup link, password and authenticator secret stay in this process and are never printed.
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A six-digit code for a step (RFC 6238 over RFC 4226, HMAC-SHA1, 30-second steps). */
export function totp(secret: string, step = Math.floor(Date.now() / 30_000)): string {
  let bits = 0;
  let value = 0;
  const key: number[] = [];
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      key.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', Buffer.from(key)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const number = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 1_000_000).padStart(6, '0');
}

export interface Staff {
  email: string;
  password: string;
  secret: string;
}

/**
 * Invites a platform admin with a fresh address, sets up their password and authenticator
 * through the console's own routes, and answers with what signing in takes.
 */
export async function makeStaff(repo: string, consoleUrl: string): Promise<Staff> {
  const email = `ui-compare-${randomBytes(4).toString('hex')}@example.test`;
  const invited = spawnSync(
    'pnpm',
    ['invite-staff', '--email', email, '--name', 'UI comparison', '--role', 'platform_admin'],
    { cwd: repo, encoding: 'utf8' },
  );
  const link = invited.stdout.match(/https?:\/\/\S+#(\S+)/);
  if (invited.status !== 0 || !link) throw new Error('pnpm invite-staff gave no setup link.');
  const token = link[1]!;
  const password = `compare ${randomBytes(12).toString('base64url')} screens`;
  const post = async (path: string, body: object) => {
    const response = await fetch(`${consoleUrl}/platform/v1/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Setting the staff member up failed at ${path}.`);
    return response.json() as Promise<{ secret?: string }>;
  };
  const { secret } = await post('setup', { token, password });
  if (!secret) throw new Error('Setup gave no authenticator secret.');
  await post('setup/confirm', { token, code: totp(secret) });
  return { email, password, secret };
}

/** A code from a step the confirmation didn't use, waiting for the next step when needed. */
export async function freshCode(secret: string, after: number): Promise<string> {
  while (Math.floor(Date.now() / 30_000) <= after) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return totp(secret);
}
