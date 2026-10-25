import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { BILLING_TIME_ZONE, licenceState, todayIn } from '@thelamp/shared';
import { type LicenceTerms, readLicence } from '../../platform/licence';
import { type Entitled, Entitlements } from '../../platform/planes';

/**
 * Entitlements on a dedicated install in licence mode (spec M23, BR-49, decision D90): the
 * signed licence's modules and user cap, checked offline at start-up. A file that doesn't check
 * out stops the install from starting. Past its expiry and 30 days' grace, the tenant may only
 * read until a new licence is in place; any other tenant may only read.
 */
export class LicenceEntitlements extends Entitlements {
  private readonly logger = new Logger(LicenceEntitlements.name);
  readonly terms: LicenceTerms;

  constructor(filePath: string, publicKeyPem: string) {
    super();
    this.terms = readLicence(readFileSync(filePath, 'utf8'), publicKeyPem);
    const { state, graceEndsOn } = licenceState(
      this.terms.expiresOn,
      todayIn(BILLING_TIME_ZONE, new Date()),
    );
    if (state !== 'valid') {
      this.logger.warn(
        `The licence for ${this.terms.tenantSlug} expired on ${this.terms.expiresOn}; ${
          state === 'grace' ? `it works until ${graceEndsOn}` : 'the install can only read'
        }.`,
      );
    }
  }

  forTenant(tenantId: string, now = new Date()): Promise<Entitled> {
    const { state } = licenceState(this.terms.expiresOn, todayIn(BILLING_TIME_ZONE, now));
    const licensed = tenantId === this.terms.tenantId;
    return Promise.resolve({
      modules: licensed ? this.terms.modules : ['core'],
      limits: { users: this.terms.users, storageGb: null, apiPerMinute: null },
      readOnly: !licensed || state === 'expired',
    });
  }
}
