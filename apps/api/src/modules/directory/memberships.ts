import { OPEN_TENANT_STATUSES } from '@thelamp/shared';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { cells, identities, memberships, tenants } from '../../db/schema/directory';
import type { DirectoryDb, DirectoryTx } from './directory.database';

export interface MembershipRow {
  membershipId: string;
  identityId: string;
  userId: string;
  authRevision: number;
  tenantId: string;
  tenantName: string;
  cellName: string;
  cellUrl: string;
}

/** Active memberships matching `where`, in tenants people may sign in to, by tenant name. */
export function activeMemberships(db: DirectoryDb | DirectoryTx, where: SQL | undefined) {
  return db
    .select({
      membershipId: memberships.id,
      identityId: memberships.identityId,
      userId: memberships.userId,
      authRevision: memberships.authRevision,
      tenantId: tenants.id,
      tenantName: tenants.name,
      cellName: cells.name,
      cellUrl: cells.apiBaseUrl,
    })
    .from(memberships)
    .innerJoin(identities, eq(identities.id, memberships.identityId))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .innerJoin(cells, eq(cells.id, tenants.cellId))
    .where(
      and(
        where,
        eq(memberships.status, 'active'),
        inArray(tenants.status, [...OPEN_TENANT_STATUSES]),
      ),
    )
    .orderBy(tenants.name);
}
