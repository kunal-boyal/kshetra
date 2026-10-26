import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Config } from '../config';
import { publicFetch } from './outbound';

/**
 * Whether a new password is one known from a breach (decision D101), so staff never choose one.
 * The check never blocks a sign-in: it runs only when a password is set.
 */
export abstract class BreachedPasswords {
  /** True when the password has appeared in a breach; false when it hasn't, or can't be told. */
  abstract seen(password: string): Promise<boolean>;
}

/**
 * Have I Been Pwned's range API: only the first five hex digits of the password's SHA-1 leave,
 * and padded answers hide which suffix was wanted. When it can't be reached in three seconds the
 * password is let through and a warning logged, so an outage there never stops setting one here.
 */
export class PwnedPasswords extends BreachedPasswords {
  private readonly logger = new Logger(PwnedPasswords.name);

  constructor(private readonly product: string) {
    super();
  }

  async seen(password: string): Promise<boolean> {
    // The range API is keyed by SHA-1; the hash is neither kept nor compared for any security.
    const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    try {
      const response = await publicFetch(
        `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
        {
          headers: { 'add-padding': 'true', 'user-agent': this.product },
          signal: AbortSignal.timeout(3000),
        },
      );
      if (!response.ok) throw new Error(`it answered ${response.status}`);
      const suffix = hash.slice(5);
      return (await response.text()).split('\n').some((line) => {
        const [rest, count] = line.trim().split(':');
        return rest === suffix && Number(count) > 0;
      });
    } catch (error) {
      this.logger.warn(
        `The breached-password check was skipped: ${error instanceof Error ? error.message : 'it failed'}`,
      );
      return false;
    }
  }
}

/** Knows a few breached passwords, for tests. */
export class MemoryBreachedPasswords extends BreachedPasswords {
  readonly known = new Set(['password1234', 'correct horse battery staple']);

  seen(password: string): Promise<boolean> {
    return Promise.resolve(this.known.has(password));
  }
}

/** Checks nothing, for working offline. */
class NoBreachCheck extends BreachedPasswords {
  seen(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export function createBreachedPasswords(config: Config): BreachedPasswords {
  switch (config.PASSWORD_BREACH_CHECK) {
    case 'pwned':
      return new PwnedPasswords(config.PRODUCT_NAME);
    case 'memory':
      return new MemoryBreachedPasswords();
    case 'off':
      return new NoBreachCheck();
  }
}
