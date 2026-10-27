import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Config } from '../config';
import { CONFIG } from './tokens';

/** GCM's full tag: a shorter one is refused, so a forged value can't pass on a guessed few bytes. */
const TAG_BYTES = 16;

interface ColumnKey {
  id: string;
  key: Buffer;
}

/** A key's ID in what it seals: the first eight hex digits of its SHA-256, never the key. */
const keyOf = (key: Buffer): ColumnKey => ({
  id: createHash('sha256').update(key).digest('hex').slice(0, 8),
  key,
});

/**
 * Secrets kept in a column, encrypted (spec 13.2): TOTP seeds, SSO and webhook secrets.
 * AES-256-GCM under `COLUMN_KEY`, with the column and row as associated data, so a value copied to
 * another row or column fails to open. Written as `v2:<key id>:<iv>:<tag>:<ciphertext>`; values
 * from before key IDs are `v1:<iv>:<tag>:<ciphertext>`.
 *
 * Rotation (decision D101): the new key becomes `COLUMN_KEY` and the old one `COLUMN_KEY_PREVIOUS`,
 * which still opens what it sealed; `pnpm reseal` then seals every value again under the new key,
 * after which the old one goes (docs/runbooks/secret-rotation.md).
 *
 * Production needs `COLUMN_KEY` in the processes that seal or open; the key is read when first
 * needed, so one that never does, such as the scheduler, holds none. Elsewhere, without one, the
 * key is derived from `OTP_PEPPER`, so a local database stays readable across restarts.
 */
@Injectable()
export class ColumnCipher {
  private keys: { current: ColumnKey; previous: ColumnKey | null } | undefined;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  private ring() {
    if (this.keys) return this.keys;
    let current: Buffer;
    if (this.config.COLUMN_KEY) {
      current = Buffer.from(this.config.COLUMN_KEY, 'base64');
    } else if (this.config.NODE_ENV !== 'production' && this.config.OTP_PEPPER) {
      new Logger(ColumnCipher.name).warn('No COLUMN_KEY: deriving one from OTP_PEPPER.');
      current = Buffer.from(
        hkdfSync('sha256', this.config.OTP_PEPPER, 'column-cipher', 'local', 32),
      );
    } else {
      throw new Error('This process holds no COLUMN_KEY, so it can neither seal nor open.');
    }
    const previous = this.config.COLUMN_KEY_PREVIOUS
      ? keyOf(Buffer.from(this.config.COLUMN_KEY_PREVIOUS, 'base64'))
      : null;
    this.keys = { current: keyOf(current), previous };
    return this.keys;
  }

  /** `where` names the column and row, such as `platform_users.totp_secret:<id>`. */
  seal(plain: string, where: string): string {
    const { current } = this.ring();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', current.key, iv, {
      authTagLength: TAG_BYTES,
    }).setAAD(Buffer.from(where));
    const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      'v2',
      current.id,
      ...[iv, cipher.getAuthTag(), sealed].map((part) => part.toString('base64url')),
    ].join(':');
  }

  open(stored: string, where: string): string {
    const { current, previous } = this.ring();
    const parts = stored.split(':');
    if (parts[0] === 'v2' && parts.length === 5) {
      const [, id, iv, tag, sealed] = parts as [string, string, string, string, string];
      const key = [current, previous].find((each) => each?.id === id);
      if (!key) throw new Error('Sealed under a key this process doesn’t hold.');
      return decrypt(key.key, iv, tag, sealed, where);
    }
    if (parts[0] === 'v1' && parts.length === 4) {
      // Before key IDs: the current key, then the previous one.
      const [, iv, tag, sealed] = parts as [string, string, string, string];
      try {
        return decrypt(current.key, iv, tag, sealed, where);
      } catch (error) {
        if (!previous) throw error;
        return decrypt(previous.key, iv, tag, sealed, where);
      }
    }
    throw new Error('Not a sealed value.');
  }

  /** Whether a value is sealed under the current key, so `pnpm reseal` can leave it as it is. */
  isCurrent(stored: string): boolean {
    const [version, id] = stored.split(':');
    return version === 'v2' && id === this.ring().current.id;
  }

  /** Seals a value again under the current key, in its own column and row. */
  reseal(stored: string, where: string): string {
    return this.seal(this.open(stored, where), where);
  }
}

function decrypt(key: Buffer, iv: string, tag: string, sealed: string, where: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
    authTagLength: TAG_BYTES,
  })
    .setAAD(Buffer.from(where))
    .setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
