import { Injectable } from '@nestjs/common';
import type { ApprovalSubject, RequestType, TenantPermission } from '@thelamp/shared';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';

/**
 * A kind of request that goes for approval, registered by the module that owns it, so the
 * workflow module never reads another module's tables (spec 5.9).
 */
export interface RequestTypeSource {
  type: RequestType;
  /** Who decides when the requester has no active manager (decision D38). */
  fallbackPermission: TenantPermission;
  /** What each request is about, for the inbox, by request ID. */
  subjects(
    tx: TenantTx,
    tenantId: string,
    requestIds: readonly string[],
  ): Promise<Map<string, ApprovalSubject>>;
  /** Applies the final decision, in the transaction that records it. */
  decided(
    tx: TenantTx,
    by: Access,
    requestId: string,
    outcome: 'approved' | 'rejected',
  ): Promise<void>;
}

@Injectable()
export class RequestTypes {
  private readonly sources = new Map<RequestType, RequestTypeSource>();

  register(source: RequestTypeSource): void {
    if (this.sources.has(source.type)) throw new Error(`${source.type} is registered already.`);
    this.sources.set(source.type, source);
  }

  get(type: RequestType): RequestTypeSource {
    const source = this.sources.get(type);
    if (!source) throw new Error(`Nothing handles ${type} requests.`);
    return source;
  }
}
