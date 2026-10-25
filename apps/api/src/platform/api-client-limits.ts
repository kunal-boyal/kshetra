import { Injectable } from '@nestjs/common';
import { API_DEFAULT_PER_MINUTE } from '@thelamp/shared';
import { Entitlements } from './planes';
import { RateLimiter } from './rate-limit';

/**
 * Requests a minute per API client (spec 11.1, M20, decision D94): the tenant's own limit, else
 * its plan's, else the default. Past it the client is answered `RATE_LIMITED` with `Retry-After`.
 */
@Injectable()
export class ApiClientLimits {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly entitlements: Entitlements,
  ) {}

  async hit(tenantId: string, apiClientId: string): Promise<void> {
    const { limits } = await this.entitlements.forTenant(tenantId);
    await this.limiter.hit(
      { name: 'api-client', max: limits.apiPerMinute ?? API_DEFAULT_PER_MINUTE, windowSeconds: 60 },
      apiClientId,
    );
  }
}
