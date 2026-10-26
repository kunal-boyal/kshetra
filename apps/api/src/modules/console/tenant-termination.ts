import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  type DataExportResult,
  deletionDue,
  newId,
  TERMINATION_KEEP_DAYS,
  type TerminateTenantBody,
} from '@thelamp/shared';
import { and, eq, inArray, isNull, lte, notExists, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import {
  cells,
  identities,
  memberships,
  platformUsers,
  refreshTokens,
  ssoConnections,
  ssoDomains,
  ssoSubjects,
  supportGrants,
  tenants,
  totpSecrets,
} from '../../db/schema/directory';
import type { StaffAccess } from '../../platform/auth';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { type StaffActor, TenantArchives } from '../../platform/planes';
import { CONFIG } from '../../platform/tokens';
import { DirectoryDatabase } from '../directory/directory.database';
import { PlatformAudit } from '../directory/platform-audit';

const DELETE_DUE = 'tenants.delete_terminated';
const HOUR_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

/** What deleting a tenant keeps, as the law asks: its invoices and what they were issued under. */
const KEPT = ['tenants', 'billing_accounts', 'subscriptions', 'invoices', 'payments'];

const notFound = () => new AppError('NOT_FOUND', 'There is no such tenant.');

/**
 * Terminating a tenant (module M22, spec M21 and 13.3, decision D95). A suspended tenant is
 * terminated from the console with a reason and its slug repeated; a final export is prepared at
 * once, which staff send the customer through a day's link. For 30 days the termination may be
 * undone; then the hourly job erases every row and file the tenant held in its cell, removes its
 * people's memberships, sessions and single sign-on from the directory, and anyone left with no
 * organisation at all, and records what went in the platform audit. Invoices stay.
 */
@Injectable()
export class TenantTermination implements OnModuleInit {
  private readonly logger = new Logger(TenantTermination.name);

  constructor(
    private readonly database: DirectoryDatabase,
    private readonly audit: PlatformAudit,
    private readonly archives: TenantArchives,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  onModuleInit(): void {
    this.queues.handle('maintenance', DELETE_DUE, async () => {
      await this.deleteDue();
    });
    this.schedules.every({
      id: DELETE_DUE,
      everyMs: HOUR_MS,
      queue: 'maintenance',
      kind: DELETE_DUE,
    });
  }

  /** Terminates a suspended tenant, then asks its cell for the final export. */
  async terminate(by: StaffAccess, id: string, body: TerminateTenantBody): Promise<void> {
    const terminated = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ slug: tenants.slug, status: tenants.status })
        .from(tenants)
        .where(eq(tenants.id, id))
        .for('update');
      if (!row) throw notFound();
      // The same request again changes nothing.
      if (row.status === 'terminated') return false;
      if (row.status !== 'suspended') {
        throw new AppError('CONFLICT', 'Suspend the tenant before terminating it.');
      }
      if (body.confirmSlug !== row.slug) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'confirmSlug', issue: `Type the tenant's slug, ${row.slug}` },
        ]);
      }
      const now = new Date();
      await tx
        .update(tenants)
        .set({ status: 'terminated', terminatedAt: now })
        .where(eq(tenants.id, id));
      await this.audit.record(tx, by, 'tenant.terminated', 'tenant', id, {
        reason: body.reason,
        deletesAt: deletionDue(now).toISOString(),
      });
      return true;
    });
    if (!terminated) return;
    // The final export: a failure here leaves the tenant terminated, and staff may ask again.
    try {
      await this.archives.request(id, newId(), await this.staff(by));
    } catch (error) {
      this.logger.error(
        `The final export of tenant ${id} wasn't asked for: ${(error as Error).message}`,
      );
    }
  }

  /** Undoes a termination before the tenant's data is deleted: it is suspended again. */
  async undo(by: StaffAccess, id: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: tenants.status, deletedAt: tenants.deletedAt })
        .from(tenants)
        .where(eq(tenants.id, id))
        .for('update');
      if (!row) throw notFound();
      if (row.status !== 'terminated') {
        throw new AppError('CONFLICT', 'The tenant is not terminated.');
      }
      if (row.deletedAt) {
        throw new AppError('CONFLICT', 'The tenant’s data is deleted already.');
      }
      await tx
        .update(tenants)
        .set({ status: 'suspended', terminatedAt: null })
        .where(eq(tenants.id, id));
      await this.audit.record(tx, by, 'tenant.termination_undone', 'tenant', id, {});
    });
  }

  async exports(id: string): Promise<DataExportResult[]> {
    await this.onThisCell(id);
    return this.archives.list(id);
  }

  async requestExport(by: StaffAccess, id: string, exportId: string): Promise<DataExportResult> {
    await this.onThisCell(id);
    return this.archives.request(id, exportId, await this.staff(by));
  }

  async readExport(by: StaffAccess, id: string, exportId: string): Promise<DataExportResult> {
    await this.onThisCell(id);
    return this.archives.read(id, exportId, await this.staff(by));
  }

  /**
   * Deletes the data of every tenant on this cell whose 30 days since termination are over.
   * Each tenant goes on its own, so one failure leaves the others done; the next run tries again.
   */
  async deleteDue(now = new Date()): Promise<number> {
    const due = await this.database.db
      .select({ id: tenants.id })
      .from(tenants)
      .innerJoin(cells, eq(cells.id, tenants.cellId))
      .where(
        and(
          eq(tenants.status, 'terminated'),
          isNull(tenants.deletedAt),
          lte(tenants.terminatedAt, new Date(now.getTime() - TERMINATION_KEEP_DAYS * DAY_MS)),
          eq(cells.name, this.config.CELL_ID),
        ),
      );
    let deleted = 0;
    for (const { id } of due) {
      try {
        await this.erase(id, now);
        deleted += 1;
      } catch (error) {
        this.logger.error(`Tenant ${id} could not be deleted: ${(error as Error).message}`);
      }
    }
    return deleted;
  }

  private async erase(id: string, now: Date): Promise<void> {
    // The cell first: if the directory's part fails after it, running again finds the cell empty.
    const removed = await this.archives.erase(id);
    await this.database.db.transaction(async (tx) => {
      const members = await tx
        .select({ id: memberships.id, identityId: memberships.identityId })
        .from(memberships)
        .where(eq(memberships.tenantId, id));
      const memberIds = members.map((member) => member.id);
      const grantIds = (
        await tx
          .select({ id: supportGrants.id })
          .from(supportGrants)
          .where(eq(supportGrants.tenantId, id))
      ).map((grant) => grant.id);
      if (memberIds.length > 0) {
        await tx.delete(refreshTokens).where(inArray(refreshTokens.membershipId, memberIds));
      }
      if (grantIds.length > 0) {
        await tx.delete(refreshTokens).where(inArray(refreshTokens.supportGrantId, grantIds));
      }
      await tx.delete(ssoSubjects).where(eq(ssoSubjects.tenantId, id));
      await tx.delete(memberships).where(eq(memberships.tenantId, id));
      await tx.delete(ssoDomains).where(eq(ssoDomains.tenantId, id));
      await tx.delete(ssoConnections).where(eq(ssoConnections.tenantId, id));
      // People who belonged to no other organisation are forgotten altogether.
      const identityIds = [...new Set(members.map((member) => member.identityId))];
      const forgotten =
        identityIds.length === 0
          ? []
          : await tx
              .select({ id: identities.id })
              .from(identities)
              .where(
                and(
                  inArray(identities.id, identityIds),
                  notExists(
                    tx
                      .select({ one: sql`1` })
                      .from(memberships)
                      .where(eq(memberships.identityId, identities.id)),
                  ),
                ),
              );
      const forgottenIds = forgotten.map((identity) => identity.id);
      if (forgottenIds.length > 0) {
        await tx.delete(totpSecrets).where(inArray(totpSecrets.identityId, forgottenIds));
        await tx.delete(identities).where(inArray(identities.id, forgottenIds));
      }
      await tx.update(tenants).set({ deletedAt: now }).where(eq(tenants.id, id));
      // The deletion certificate: what went, and what the law keeps.
      await this.audit.record(tx, null, 'tenant.deleted', 'tenant', id, {
        cellRows: removed.rows,
        files: removed.files,
        memberships: memberIds.length,
        people: forgottenIds.length,
        kept: KEPT,
      });
    });
  }

  private async onThisCell(id: string): Promise<void> {
    const [row] = await this.database.db
      .select({ cell: cells.name })
      .from(tenants)
      .innerJoin(cells, eq(cells.id, tenants.cellId))
      .where(eq(tenants.id, id));
    if (!row) throw notFound();
    if (row.cell !== this.config.CELL_ID) {
      throw new AppError(
        'CONFLICT',
        `The tenant lives on cell ${row.cell}; use that cell's console for its exports.`,
      );
    }
  }

  private async staff(by: StaffAccess): Promise<StaffActor> {
    const [row] = await this.database.db
      .select({ name: platformUsers.name })
      .from(platformUsers)
      .where(eq(platformUsers.id, by.staffId));
    return { staffId: by.staffId, name: row?.name ?? 'Vendor staff' };
  }
}
