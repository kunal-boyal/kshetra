import { Injectable } from '@nestjs/common';
import type {
  ApprovalSubject,
  RequestType,
  SwitchableModule,
  TenantPermission,
} from '@thelamp/shared';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';

/** How a request ended: decided by its approvers, or withdrawn by its requester (M15). */
export type RequestOutcome = 'approved' | 'rejected' | 'cancelled';

/**
 * A kind of request that goes for approval, registered by the module that owns it, so the
 * workflow module never reads another module's tables (spec 5.9).
 */
export interface RequestTypeSource {
  type: RequestType;
  /**
   * Who decides when the type has no chain and the requester has no active manager (decision
   * D38). A type with a chain falls back to the tenant's fallback role instead (BR-31).
   */
  fallbackPermission: TenantPermission;
  /** Whether many requests of this type may be approved in one go from the inbox (M15). */
  bulk?: boolean;
  /**
   * The module the type belongs to, when it isn't Core's. While the tenant has it switched off,
   * its requests leave the inbox and refuse decisions, and come back unchanged when it is switched
   * on again (decision D83).
   */
  module?: SwitchableModule;
  /**
   * Decided only on the owning module's own page, which asks for more than a note, such as an
   * order's configured rejection reason (decision D78): the portal's path for a request. The inbox
   * links there instead.
   */
  ownPage?: (requestId: string) => string;
  /** What each request is about, for the inbox, by request ID. */
  subjects(
    tx: TenantTx,
    tenantId: string,
    requestIds: readonly string[],
  ): Promise<Map<string, ApprovalSubject>>;
  /**
   * Applies how the request ended, in the transaction that records it. A withdrawn request
   * leaves its record as a rejected one would.
   */
  decided(tx: TenantTx, by: Access, requestId: string, outcome: RequestOutcome): Promise<void>;
}

/** Who fills an account's slots, for `account_slot` steps: the accounts module provides it. */
export interface AccountSlotsSource {
  /** Every slot key of every account type, to check chains with. */
  keys(tx: TenantTx, tenantId: string): Promise<Set<string>>;
  /** The active user in a slot of an account today, if anyone. */
  holder(tx: TenantTx, tenantId: string, accountId: string, slot: string): Promise<string | null>;
}

@Injectable()
export class RequestTypes {
  private readonly sources = new Map<RequestType, RequestTypeSource>();
  private slotSource: AccountSlotsSource | undefined;

  register(source: RequestTypeSource): void {
    if (this.sources.has(source.type)) throw new Error(`${source.type} is registered already.`);
    this.sources.set(source.type, source);
  }

  get(type: RequestType): RequestTypeSource {
    const source = this.sources.get(type);
    if (!source) throw new Error(`Nothing handles ${type} requests.`);
    return source;
  }

  /** The types whose module is among these switched-off modules. */
  closedBy(off: readonly SwitchableModule[]): RequestType[] {
    return [...this.sources.values()]
      .filter((source) => source.module && off.includes(source.module))
      .map((source) => source.type);
  }

  /** Whether a module handles this type yet; chains may exist for types still to come. */
  has(type: RequestType): boolean {
    return this.sources.has(type);
  }

  provideSlots(source: AccountSlotsSource): void {
    if (this.slotSource) throw new Error('Account slots are provided already.');
    this.slotSource = source;
  }

  get slots(): AccountSlotsSource {
    if (!this.slotSource) throw new Error('Nothing provides account slots.');
    return this.slotSource;
  }
}
