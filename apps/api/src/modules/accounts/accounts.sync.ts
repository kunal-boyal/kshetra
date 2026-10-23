import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { SyncAccount, SyncContact } from '@thelamp/shared';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { accounts, accountSlots, accountTypes, contacts } from '../../db/schema/accounts';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { pointOf } from '../../platform/geo';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';
import { AccountsService, slotsOn } from './accounts.service';

/**
 * The accounts a phone keeps (spec 5.5, 11.3): the ones the caller sees, so a field user works
 * them offline. Accounts enter and leave the caller's reach as slots and attachments change, so
 * the scope is a hash of the accounts they see; a slot change restamps its account, and the
 * nightly upkeep restamps those whose holders change that day.
 */
@Injectable()
export class AccountsSync implements SyncSource<SyncAccount>, OnModuleInit {
  readonly name = 'accounts';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly accounts: AccountsService,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  async scope(tx: TenantTx, access: Access): Promise<string> {
    return seenHash(tx, access, this.accounts);
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncAccount>[]> {
    if (!access.permissions.has('account.view')) return [];
    const found = await tx
      .select({
        version: accounts.rowVersion,
        id: accounts.id,
        type: accountTypes.key,
        code: accounts.code,
        name: accounts.name,
        territoryId: accounts.territoryId,
        parentId: accounts.parentAccountId,
        address: accounts.address,
        location: pointOf(accounts.location),
        geofenceRadiusM: accounts.geofenceRadiusM,
        locationStatus: accounts.locationStatus,
        status: accounts.status,
        segments: accounts.segments,
        custom: accounts.custom,
      })
      .from(accounts)
      .innerJoin(
        accountTypes,
        and(eq(accountTypes.tenantId, accounts.tenantId), eq(accountTypes.id, accounts.typeId)),
      )
      .where(
        and(
          eq(accounts.tenantId, access.tenantId),
          await this.accounts.reach(tx, access),
          gte(accounts.rowVersion, page.since),
          page.after
            ? sql`(${accounts.rowVersion}, ${accounts.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(accounts.rowVersion), asc(accounts.id))
      .limit(page.limit);
    const today = await this.accounts.today(tx, access.tenantId);
    const holders =
      found.length === 0
        ? []
        : await tx
            .select({
              accountId: accountSlots.accountId,
              slot: accountSlots.slotKey,
              userId: accountSlots.userId,
            })
            .from(accountSlots)
            .where(
              and(
                eq(accountSlots.tenantId, access.tenantId),
                inArray(
                  accountSlots.accountId,
                  found.map((row) => row.id),
                ),
                slotsOn(today),
              ),
            )
            .orderBy(asc(accountSlots.slotKey));
    return found.map(({ version, ...row }) => ({
      version,
      id: row.id,
      row: {
        ...row,
        slots: holders
          .filter((holder) => holder.accountId === row.id)
          .map(({ slot, userId }) => ({ slot, userId })),
      },
    }));
  }
}

/** The contacts of the accounts a phone keeps; they come and go with their accounts. */
@Injectable()
export class ContactsSync implements SyncSource<SyncContact>, OnModuleInit {
  readonly name = 'contacts';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly accounts: AccountsService,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  async scope(tx: TenantTx, access: Access): Promise<string> {
    return seenHash(tx, access, this.accounts);
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncContact>[]> {
    if (!access.permissions.has('account.view')) return [];
    const found = await tx
      .select({
        version: contacts.rowVersion,
        id: contacts.id,
        accountId: contacts.accountId,
        name: contacts.name,
        role: contacts.role,
        phone: contacts.phone,
        email: contacts.email,
        active: contacts.active,
      })
      .from(contacts)
      .innerJoin(
        accounts,
        and(eq(accounts.tenantId, contacts.tenantId), eq(accounts.id, contacts.accountId)),
      )
      .where(
        and(
          eq(contacts.tenantId, access.tenantId),
          await this.accounts.reach(tx, access),
          gte(contacts.rowVersion, page.since),
          page.after
            ? sql`(${contacts.rowVersion}, ${contacts.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(contacts.rowVersion), asc(contacts.id))
      .limit(page.limit);
    return found.map(({ version, ...row }) => ({ version, id: row.id, row }));
  }
}

/** Everything, nothing, or a hash of the accounts the caller sees today. */
async function seenHash(tx: TenantTx, access: Access, service: AccountsService): Promise<string> {
  if (!access.permissions.has('account.view')) return 'none';
  if (access.scope === 'tenant') return 'tenant';
  const [row] = await tx
    .select({
      hash: sql<string>`md5(coalesce(string_agg(${accounts.id}::text, ',' order by ${accounts.id}), ''))`,
    })
    .from(accounts)
    .where(and(eq(accounts.tenantId, access.tenantId), await service.reach(tx, access)));
  return row!.hash;
}
