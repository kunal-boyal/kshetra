import { Resolver } from 'node:dns/promises';
import type { Config } from '../config';

/**
 * TXT records of a domain, for proving an organisation holds the email domain its single sign-on
 * claims (ASVS V6.8.1, decision D101). Nothing found, or no answer, is no records.
 */
export abstract class DomainRecords {
  abstract txt(name: string): Promise<string[]>;
}

/** The public DNS, through the cell's resolver, with a short timeout. */
export class DnsDomainRecords extends DomainRecords {
  private readonly resolver = new Resolver({ timeout: 3000, tries: 2 });

  async txt(name: string): Promise<string[]> {
    try {
      return (await this.resolver.resolveTxt(name)).map((chunks) => chunks.join(''));
    } catch {
      return [];
    }
  }
}

/** Records a test sets, for tests. */
export class MemoryDomainRecords extends DomainRecords {
  readonly records = new Map<string, string[]>();

  set(name: string, values: string[]): void {
    this.records.set(name.toLowerCase(), values);
  }

  txt(name: string): Promise<string[]> {
    return Promise.resolve(this.records.get(name.toLowerCase()) ?? []);
  }
}

export function createDomainRecords(config: Config): DomainRecords {
  return config.DOMAIN_RECORDS === 'memory' ? new MemoryDomainRecords() : new DnsDomainRecords();
}
