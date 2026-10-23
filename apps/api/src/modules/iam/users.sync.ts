import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { SyncUser } from '@thelamp/shared';
import { and, asc, eq, gte, type SQL, sql } from 'drizzle-orm';
import { designations, roles, users } from '../../db/schema/iam';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';
import { Scopes } from './scopes';

/**
 * The people a phone keeps (spec 11.3): the caller, and for those who may view users, everyone
 * their scope reaches. Deactivated people stay, with their status, so the phone can show them as
 * such; nobody is deleted.
 */
@Injectable()
export class UsersSync implements SyncSource<SyncUser>, OnModuleInit {
  readonly name = 'users';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly scopes: Scopes,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  private reachesOthers(access: Access): boolean {
    return access.permissions.has('user.view') && access.scope !== 'self';
  }

  private async reach(tx: TenantTx, access: Access): Promise<SQL> {
    return this.reachesOthers(access) ? this.scopes.users(tx, access) : eq(users.id, access.userId);
  }

  /** The tenant, the caller alone, or a hash of the people a team or territory scope reaches. */
  async scope(tx: TenantTx, access: Access): Promise<string> {
    if (!this.reachesOthers(access)) return 'self';
    if (access.scope === 'tenant') return 'tenant';
    const [row] = await tx
      .select({
        hash: sql<string>`md5(coalesce(string_agg(${users.id}::text, ',' order by ${users.id}), ''))`,
      })
      .from(users)
      .where(and(eq(users.tenantId, access.tenantId), await this.reach(tx, access)));
    return row!.hash;
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncUser>[]> {
    const found = await tx
      .select({
        version: users.rowVersion,
        id: users.id,
        code: users.code,
        name: users.name,
        phone: users.phoneE164,
        designation: designations.key,
        role: roles.key,
        managerId: users.managerId,
        status: users.status,
      })
      .from(users)
      .innerJoin(
        designations,
        and(eq(designations.tenantId, users.tenantId), eq(designations.id, users.designationId)),
      )
      .innerJoin(roles, and(eq(roles.tenantId, users.tenantId), eq(roles.id, users.roleId)))
      .where(
        and(
          eq(users.tenantId, access.tenantId),
          await this.reach(tx, access),
          gte(users.rowVersion, page.since),
          page.after
            ? sql`(${users.rowVersion}, ${users.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(users.rowVersion), asc(users.id))
      .limit(page.limit);
    return found.map(({ version, ...row }) => ({ version, id: row.id, row }));
  }
}
