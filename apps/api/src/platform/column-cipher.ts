import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Config } from '../config';
import { CONFIG } from './tokens';

/**
 * Secrets kept in a column, encrypted (spec 13.2): TOTP seeds now, SSO and webhook secrets later.
 * AES-256-GCM under `COLUMN_KEY`, with the column and row as associated data, so a value copied to
 * another row or column fails to open. Written as `v1:<iv>:<tag>:<ciphertext>`.
 *
 * Production needs `COLUMN_KEY`. Elsewhere, without one, the key is derived from `OTP_PEPPER`, so
 * a local database stays readable across restarts.
 */
@Injectable()
export class ColumnCipher {
  private readonly key: Buffer;

  constructor(@Inject(CONFIG) config: Config) {
    if (config.COLUMN_KEY) {
      this.key = Buffer.from(config.COLUMN_KEY, 'base64');
    } else {
      new Logger(ColumnCipher.name).warn('No COLUMN_KEY: deriving one from OTP_PEPPER.');
      this.key = Buffer.from(hkdfSync('sha256', config.OTP_PEPPER, 'column-cipher', 'local', 32));
    }
  }

  /** `where` names the column and row, such as `platform_users.totp_secret:<id>`. */
  seal(plain: string, where: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv).setAAD(Buffer.from(where));
    const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), sealed]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join(':');
  }

  open(stored: string, where: string): string {
    const [version, iv, tag, sealed] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || sealed === undefined) {
      throw new Error('Not a sealed value.');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'))
      .setAAD(Buffer.from(where))
      .setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
