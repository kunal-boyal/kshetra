import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  isOpenTenant,
  newId,
  type SignedIn,
  type SupportDecisionBody,
  type SupportGrantQuery,
  type SupportGrantResult,
  supportApprovalIssue,
  type SupportRequestBody,
  supportRequestIssue,
  supportStatus,
} from '@thelamp/shared';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { Config } from '../../config';
import { platformUsers, refreshTokens, supportGrants, tenants } from '../../db/schema/directory';
import type { Access, StaffAccess } from '../../platform/auth';
import {
  type OpenSupportGrant,
  PeopleNames,
  type SupportChange,
  SupportGrants,
  SupportNotices,
} from '../../platform/planes';
import { RedisClient } from '../../platform/redis';
import { CONFIG } from '../../platform/tokens';
import { DirectoryDatabase, type DirectoryTx } from './directory.database';
import { PlatformAudit } from './platform-audit';
import { digest, newSecret } from './secrets';
import { SessionsService } from './sessions.service';
import { grantOpen, grantResult, type SupportGrantRow, supportGrantRows } from './support-grants';

/** A link into the portal works once, for a minute. */
export const SUPPORT_ENTRY_SECONDS = 60;

const notFound = () => new AppError('NOT_FOUND', 'This was not found.');
const invalid = (detail: { path: string; issue: string }) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', [detail]);
const notWaiting = () =>
  new AppError('CONFLICT', 'This request was already decided or has lapsed.');

/**
 * Support access (module M22, decision D93), kept in the directory: vendor staff ask to enter a
 * tenant; its admins approve, narrower if they like, or decline; an emergency request is approved
 * by a second vendor admin instead and reads only. Either side may end a grant at any time. The
 * tenant's cell hears of each change made on the vendor's side through `SupportNotices`.
 */
@Injectable()
export class SupportService extends SupportGrants {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly audit: PlatformAudit,
    private readonly notices: SupportNotices,
    private readonly names: PeopleNames,
    private readonly sessions: SessionsService,
    private readonly client: RedisClient,
    @Inject(CONFIG) private readonly config: Config,
  ) {
    super();
  }

  /** The cell's question on every request of a support session: is its grant open now? */
  async open(grantId: string): Promise<OpenSupportGrant | null> {
    const [row] = await supportGrantRows(this.database.db, eq(supportGrants.id, grantId), 1);
    if (!row || !grantOpen(row)) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      staffId: row.staffId,
      staffName: row.staffName,
      staffRevision: row.staffRevision,
      write: row.grantedScope === 'write',
      endsAt: row.endsAt!,
    };
  }

  /** The console's list: by tenant, by status, or the staff member's own. */
  async list(staff: StaffAccess, query: SupportGrantQuery): Promise<SupportGrantResult[]> {
    const filters: SQL[] = [];
    if (query.tenantId) filters.push(eq(supportGrants.tenantId, query.tenantId));
    if (query.mine) filters.push(eq(supportGrants.platformUserId, staff.staffId));
    const rows = await supportGrantRows(this.database.db, and(...filters), 200);
    const now = new Date();
    return rows
      .map((row) => grantResult(row, now))
      .filter((grant) => !query.status || grant.status === query.status);
  }

  /** A tenant's grants, newest first, for its admins in Settings. */
  async forTenant(tenantId: string): Promise<SupportGrantResult[]> {
    const rows = await supportGrantRows(this.database.db, eq(supportGrants.tenantId, tenantId), 50);
    const now = new Date();
    return rows.map((row) => grantResult(row, now));
  }

  /** A staff member asks to enter a tenant. One waiting or open grant a tenant each. */
  async request(staff: StaffAccess, body: SupportRequestBody): Promise<SupportGrantResult> {
    const issue = supportRequestIssue(body);
    if (issue) throw invalid(issue);
    const id = newId();
    await this.database.db.transaction(async (tx) => {
      const [tenant] = await tx
        .select({ status: tenants.status })
        .from(tenants)
        .where(eq(tenants.id, body.tenantId));
      if (!tenant) throw notFound();
      if (!isOpenTenant(tenant.status)) {
        throw invalid({ path: 'tenantId', issue: 'This organisation is not open' });
      }
      const now = new Date();
      const mine = await supportGrantRows(
        tx,
        and(
          eq(supportGrants.tenantId, body.tenantId),
          eq(supportGrants.platformUserId, staff.staffId),
        ),
        20,
      );
      if (mine.some((row) => ['requested', 'active'].includes(supportStatus(row, now)))) {
        throw new AppError(
          'CONFLICT',
          'You already have a request or access for this organisation. End it first.',
        );
      }
      await tx.insert(supportGrants).values({
        id,
        tenantId: body.tenantId,
        platformUserId: staff.staffId,
        reason: body.reason,
        scope: body.scope,
        hours: body.hours,
        emergency: body.emergency,
      });
      await this.audit.record(tx, staff, 'support.requested', 'tenant', body.tenantId, {
        grantId: id,
        scope: body.scope,
        hours: body.hours,
        emergency: body.emergency,
      });
    });
    const row = await this.row(id);
    await this.tell(row, 'support.requested', staff.staffId);
    return grantResult(row);
  }

  /**
   * A second vendor admin approves an emergency request (spec M22): reading only, from now for the
   * hours asked. The tenant's admins are notified at once.
   */
  async approveEmergency(staff: StaffAccess, grantId: string): Promise<SupportGrantResult> {
    const row = await this.database.db.transaction(async (tx) => {
      const row = await this.locked(tx, grantId);
      if (!row.emergency) {
        throw new AppError('FORBIDDEN', 'Only emergency requests are approved in the console.');
      }
      if (row.staffId === staff.staffId) {
        throw new AppError('FORBIDDEN', 'A second admin approves emergency access, not you.');
      }
      if (supportStatus(row, new Date()) !== 'requested') throw notWaiting();
      const name = await this.staffName(tx, staff.staffId);
      await this.start(tx, row, 'read', row.hours, { staffId: staff.staffId, name });
      await this.audit.record(tx, staff, 'support.emergency_approved', 'tenant', row.tenantId, {
        grantId,
        hours: row.hours,
      });
      return this.row(grantId, tx);
    });
    await this.tell(row, 'support.approved', staff.staffId);
    return grantResult(row);
  }

  /** The tenant's admin approves, perhaps narrower or shorter, or declines a waiting request. */
  async decide(
    access: Access,
    grantId: string,
    body: SupportDecisionBody,
  ): Promise<{ before: SupportGrantResult; after: SupportGrantResult }> {
    this.refuseSupport(access);
    const name = (await this.names.nameOf(access.tenantId, access.userId)) ?? '';
    return this.database.db.transaction(async (tx) => {
      const row = await this.locked(tx, grantId, access.tenantId);
      if (supportStatus(row, new Date()) !== 'requested') throw notWaiting();
      const before = grantResult(row);
      if (body.approve) {
        const given = { scope: body.scope ?? row.scope, hours: body.hours ?? row.hours };
        const issue = supportApprovalIssue(row, given);
        if (issue) throw invalid(issue);
        await this.start(tx, row, given.scope, given.hours, { userId: access.userId, name });
      } else {
        await tx
          .update(supportGrants)
          .set({ declinedAt: new Date(), closedByUserId: access.userId, closedByName: name })
          .where(eq(supportGrants.id, grantId));
      }
      return { before, after: grantResult(await this.row(grantId, tx)) };
    });
  }

  /** The tenant's admin ends a grant, or withdraws a request nobody decided yet. */
  async endForTenant(
    access: Access,
    grantId: string,
  ): Promise<{ before: SupportGrantResult; after: SupportGrantResult }> {
    this.refuseSupport(access);
    const name = (await this.names.nameOf(access.tenantId, access.userId)) ?? '';
    return this.database.db.transaction(async (tx) => {
      const row = await this.locked(tx, grantId, access.tenantId);
      const before = grantResult(row);
      await this.close(tx, row, { userId: access.userId, name });
      return { before, after: grantResult(await this.row(grantId, tx)) };
    });
  }

  /**
   * Vendor staff end a grant early, or withdraw a request: the staff member it is for, or a vendor
   * admin. Its sessions end with it.
   */
  async endForStaff(staff: StaffAccess, grantId: string): Promise<SupportGrantResult> {
    const row = await this.database.db.transaction(async (tx) => {
      const row = await this.locked(tx, grantId);
      if (
        row.staffId !== staff.staffId &&
        !staff.permissions.has('platform.support.approve_emergency')
      ) {
        throw new AppError('FORBIDDEN', 'Only its staff member or a vendor admin can end this.');
      }
      const name = await this.staffName(tx, staff.staffId);
      await this.close(tx, row, { staffId: staff.staffId, name });
      await this.audit.record(tx, staff, 'support.ended', 'tenant', row.tenantId, { grantId });
      return this.row(grantId, tx);
    });
    await this.tell(row, 'support.ended', staff.staffId);
    return grantResult(row);
  }

  /**
   * A one-time link into the tenant's portal under an open grant, for the staff member it is for
   * (decision D93). It works once, for a minute, and starts a web session that ends with the grant.
   */
  async entry(staff: StaffAccess, grantId: string): Promise<{ url: string }> {
    const row = await this.row(grantId);
    if (row.staffId !== staff.staffId) {
      throw new AppError('FORBIDDEN', 'Only the staff member it was granted to can use it.');
    }
    if (!grantOpen(row)) {
      throw new AppError('CONFLICT', 'This access is not open. Ask for it again.');
    }
    const code = newSecret();
    await this.client.redis.set(
      `support-entry:${digest(code)}`,
      JSON.stringify({ grantId, staffId: staff.staffId }),
      'EX',
      SUPPORT_ENTRY_SECONDS,
    );
    await this.database.db.transaction((tx) =>
      this.audit.record(tx, staff, 'support.entered', 'tenant', row.tenantId, { grantId }),
    );
    return { url: `${this.config.WEB_URL}/auth/v1/support/enter?code=${encodeURIComponent(code)}` };
  }

  /** Spends an entry link, and starts the support session it was made for. */
  async enter(code: string): Promise<SignedIn> {
    const held = await this.client.redis.getdel(`support-entry:${digest(code)}`);
    if (!held) throw new AppError('SESSION_REVOKED', 'This link has expired. Open it again.');
    const { grantId, staffId } = JSON.parse(held) as { grantId: string; staffId: string };
    const row = await this.row(grantId);
    if (row.staffId !== staffId) throw new AppError('SESSION_REVOKED', 'This link has expired.');
    return this.sessions.supportSignIn(row);
  }

  /** Support itself never decides on or ends access; someone at the tenant does. */
  private refuseSupport(access: Access): void {
    if (access.support) {
      throw new AppError('FORBIDDEN', 'Vendor support can’t decide on its own access.');
    }
  }

  private async start(
    tx: DirectoryTx,
    row: SupportGrantRow,
    scope: 'read' | 'write',
    hours: number,
    by: { userId?: string; staffId?: string; name: string },
  ): Promise<void> {
    const startsAt = new Date();
    await tx
      .update(supportGrants)
      .set({
        grantedScope: scope,
        hours,
        startsAt,
        endsAt: new Date(startsAt.getTime() + hours * 3_600_000),
        approvedByUserId: by.userId ?? null,
        approvedByStaffId: by.staffId ?? null,
        approvedByName: by.name,
      })
      .where(eq(supportGrants.id, row.id));
  }

  /** Ends an open grant or withdraws a waiting request, with every session under it. */
  private async close(
    tx: DirectoryTx,
    row: SupportGrantRow,
    by: { userId?: string; staffId?: string; name: string },
  ): Promise<void> {
    const status = supportStatus(row, new Date());
    if (status !== 'requested' && status !== 'active') {
      throw new AppError('CONFLICT', 'This access has already ended.');
    }
    await tx
      .update(supportGrants)
      .set({
        revokedAt: new Date(),
        closedByUserId: by.userId ?? null,
        closedByStaffId: by.staffId ?? null,
        closedByName: by.name,
      })
      .where(eq(supportGrants.id, row.id));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.supportGrantId, row.id), isNull(refreshTokens.revokedAt)));
  }

  /** A grant, locked for a change; another tenant's is not found. */
  private async locked(
    tx: DirectoryTx,
    grantId: string,
    tenantId?: string,
  ): Promise<SupportGrantRow> {
    const [lock] = await tx
      .select({ id: supportGrants.id, tenantId: supportGrants.tenantId })
      .from(supportGrants)
      .where(eq(supportGrants.id, grantId))
      .for('update');
    if (!lock || (tenantId && lock.tenantId !== tenantId)) throw notFound();
    return this.row(grantId, tx);
  }

  private async row(
    grantId: string,
    tx: DirectoryTx | undefined = undefined,
  ): Promise<SupportGrantRow> {
    const [row] = await supportGrantRows(tx ?? this.database.db, eq(supportGrants.id, grantId), 1);
    if (!row) throw notFound();
    return row;
  }

  private async staffName(tx: DirectoryTx, staffId: string): Promise<string> {
    const [found] = await tx
      .select({ name: platformUsers.name })
      .from(platformUsers)
      .where(eq(platformUsers.id, staffId));
    return found?.name ?? '';
  }

  /** Tells the tenant's cell what vendor staff did, for its audit log and its admins. */
  private async tell(
    row: SupportGrantRow,
    action: SupportChange['action'],
    byStaffId: string,
  ): Promise<void> {
    await this.notices.record(row.tenantId, {
      action,
      grantId: row.id,
      byStaffId,
      staffName: row.staffName,
      reason: row.reason,
      scope: row.grantedScope ?? row.scope,
      hours: row.hours,
      emergency: row.emergency,
      endsAt: row.endsAt,
    });
  }
}
