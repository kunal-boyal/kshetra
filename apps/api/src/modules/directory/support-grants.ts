import {
  isOpenTenant,
  type SupportGrantResult,
  type SupportScopeKey,
  supportStatus,
  type SupportStatusKey,
  type TenantStatus,
} from '@thelamp/shared';
import { desc, eq, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { cells, platformUsers, supportGrants, tenants } from '../../db/schema/directory';
import type { DirectoryDb, DirectoryTx } from './directory.database';

/** A support grant with what its readers need: the tenant, its cell and the staff member. */
export interface SupportGrantRow {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  cellName: string;
  cellUrl: string;
  staffId: string;
  staffName: string;
  staffActive: boolean;
  staffRevision: number;
  reason: string;
  scope: SupportScopeKey;
  hours: number;
  emergency: boolean;
  grantedScope: SupportScopeKey | null;
  approvedByUserId: string | null;
  approvedByStaffId: string | null;
  approvedByName: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  closedByUserId: string | null;
  closedByStaffId: string | null;
  closedByName: string | null;
  createdAt: Date;
}

const staff = alias(platformUsers, 'staff');

/** Support grants matching `where`, newest first, `limit` of them. */
export function supportGrantRows(
  db: DirectoryDb | DirectoryTx,
  where: SQL | undefined,
  limit = 100,
): Promise<SupportGrantRow[]> {
  return db
    .select({
      id: supportGrants.id,
      tenantId: supportGrants.tenantId,
      tenantName: tenants.name,
      tenantStatus: tenants.status,
      cellName: cells.name,
      cellUrl: cells.apiBaseUrl,
      staffId: supportGrants.platformUserId,
      staffName: staff.name,
      staffStatus: staff.status,
      staffRevision: staff.authRevision,
      reason: supportGrants.reason,
      scope: supportGrants.scope,
      hours: supportGrants.hours,
      emergency: supportGrants.emergency,
      grantedScope: supportGrants.grantedScope,
      approvedByUserId: supportGrants.approvedByUserId,
      approvedByStaffId: supportGrants.approvedByStaffId,
      approvedByName: supportGrants.approvedByName,
      startsAt: supportGrants.startsAt,
      endsAt: supportGrants.endsAt,
      declinedAt: supportGrants.declinedAt,
      revokedAt: supportGrants.revokedAt,
      closedByUserId: supportGrants.closedByUserId,
      closedByStaffId: supportGrants.closedByStaffId,
      closedByName: supportGrants.closedByName,
      createdAt: supportGrants.createdAt,
    })
    .from(supportGrants)
    .innerJoin(tenants, eq(tenants.id, supportGrants.tenantId))
    .innerJoin(cells, eq(cells.id, tenants.cellId))
    .innerJoin(staff, eq(staff.id, supportGrants.platformUserId))
    .where(where)
    .orderBy(desc(supportGrants.createdAt))
    .limit(limit)
    .then((rows) =>
      rows.map(({ staffStatus, ...row }) => ({ ...row, staffActive: staffStatus === 'active' })),
    );
}

/**
 * Whether a grant lets its staff member into the tenant now: approved and not over, the staff
 * member still active, and the tenant open.
 */
export function grantOpen(row: SupportGrantRow, now = new Date()): boolean {
  return (
    supportStatus(row, now) === 'active' &&
    row.staffActive &&
    isOpenTenant(row.tenantStatus) &&
    row.grantedScope !== null
  );
}

/** A grant as the console and the portal show it. */
export function grantResult(row: SupportGrantRow, now = new Date()): SupportGrantResult {
  const status: SupportStatusKey = supportStatus(row, now);
  const decider = (userId: string | null, staffId: string | null, name: string | null) =>
    userId || staffId
      ? { kind: userId ? ('user' as const) : ('staff' as const), name: name ?? '' }
      : null;
  return {
    id: row.id,
    tenant: { id: row.tenantId, name: row.tenantName },
    staff: { id: row.staffId, name: row.staffName },
    reason: row.reason,
    scope: row.scope,
    hours: row.hours,
    emergency: row.emergency,
    status,
    grantedScope: row.grantedScope,
    approvedBy: decider(row.approvedByUserId, row.approvedByStaffId, row.approvedByName),
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    closedAt: (row.declinedAt ?? row.revokedAt)?.toISOString() ?? null,
    closedBy: decider(row.closedByUserId, row.closedByStaffId, row.closedByName),
    createdAt: row.createdAt.toISOString(),
  };
}
