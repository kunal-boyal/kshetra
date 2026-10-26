import { Injectable } from '@nestjs/common';
import { API_DEFAULT_PER_MINUTE } from '@thelamp/shared';
import { Entitlements } from './planes';
import { RateLimiter } from './rate-limit';

/**
 * Requests a minute per API client (spec 11.1, M20, decision D94): the tenant's own limit, else
 * its plan's, else the default. Past it the client is answered `RATE_LIMITED` with `Retry-After`.
 * The whole tenant, people and clients together, has its plan's `requestsPerMinute` too (spec
 * 10.3, decision D98), so one tenant can't take a shared cell's capacity; without one it is open.
 */
@Injectable()
export class ApiClientLimits {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly entitlements: Entitlements,
  ) {}

  async tenant(tenantId: string): Promise<void> {
    const { limits } = await this.entitlements.forTenant(tenantId);
    if (limits.requestsPerMinute === null) return;
    await this.limiter.hit(
      { name: 'tenant', max: limits.requestsPerMinute, windowSeconds: 60 },
      tenantId,
    );
  }

  async hit(tenantId: string, apiClientId: string): Promise<void> {
    const { limits } = await this.entitlements.forTenant(tenantId);
    await this.limiter.hit(
      { name: 'api-client', max: limits.apiPerMinute ?? API_DEFAULT_PER_MINUTE, windowSeconds: 60 },
      apiClientId,
    );
  }
}
