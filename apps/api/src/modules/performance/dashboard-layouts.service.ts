import { Injectable } from '@nestjs/common';
import {
  AppError,
  type DashboardCard,
  dashboardLayoutIssues,
  type DashboardLayoutListResult,
  type DashboardLayoutRow,
} from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { dashboardLayouts } from '../../db/schema/metrics';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { notFound } from '../iam/actor';
import { RolesService } from '../iam/roles.service';
import { PerformanceService } from './performance.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';

/**
 * Home layouts (M18, decision D122): an admin sets each role's Home as cards in order, checked as
 * configuration is; a role without one keeps the standard Home, and so does every role while the
 * advanced analytics module is off.
 */
@Injectable()
export class DashboardLayoutsService {
  constructor(
    private readonly roles: RolesService,
    private readonly performance: PerformanceService,
    private readonly territories: TerritoriesService,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  /** Every role with its layout, in the roles' order. */
  async list(tx: TenantTx, tenantId: string): Promise<DashboardLayoutListResult> {
    const rows = await tx
      .select()
      .from(dashboardLayouts)
      .where(eq(dashboardLayouts.tenantId, tenantId));
    const byRole = new Map(rows.map((row) => [row.roleId, row]));
    const metrics = await this.performance.layoutMetrics(tx, tenantId);
    return {
      metrics: metrics
        .filter((metric) => metric.available)
        .map(({ key, name, additive }) => ({ key, name, additive })),
      levels: (await this.territories.levels(tx, tenantId)).map(({ key, name }) => ({ key, name })),
      items: (await this.roles.list(tx, tenantId)).map((role) => ({
        role: { id: role.id, key: role.key, name: role.name },
        cards: byRole.get(role.id)?.cards ?? null,
        updatedAt: byRole.get(role.id)?.updatedAt.toISOString() ?? null,
      })),
    };
  }

  /** Sets a role's layout, or (`null`) gives it back the standard Home; audited. */
  async set(
    tx: TenantTx,
    access: Access,
    roleId: string,
    cards: DashboardCard[] | null,
  ): Promise<DashboardLayoutRow> {
    const role = (await this.roles.list(tx, access.tenantId)).find((entry) => entry.id === roleId);
    if (!role) throw notFound();
    if (cards) {
      const issues = dashboardLayoutIssues(
        cards,
        await this.performance.layoutMetrics(tx, access.tenantId),
        (await this.territories.levels(tx, access.tenantId)).map((level) => level.key),
      );
      if (issues.length > 0) {
        throw new AppError('VALIDATION', 'The layout names something that is not there.', issues);
      }
    }
    const before = await this.forRole(tx, access.tenantId, roleId);
    const now = new Date();
    const [row] = await tx
      .insert(dashboardLayouts)
      .values({
        tenantId: access.tenantId,
        roleId,
        cards,
        createdBy: access.userId,
        updatedBy: access.userId,
      })
      .onConflictDoUpdate({
        target: [dashboardLayouts.tenantId, dashboardLayouts.roleId],
        set: { cards, updatedAt: now, updatedBy: access.userId },
      })
      .returning();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'dashboard_layout.changed',
      target: { type: 'role', id: roleId },
      before: { cards: before },
      after: { cards },
    });
    return {
      role: { id: role.id, key: role.key, name: role.name },
      cards: row!.cards ?? null,
      updatedAt: row!.updatedAt.toISOString(),
    };
  }

  /** The roles with a layout, by role key: what a configuration export carries (D66). */
  async byRoleKey(tx: TenantTx, tenantId: string): Promise<Record<string, DashboardCard[]>> {
    const rows = await tx
      .select()
      .from(dashboardLayouts)
      .where(eq(dashboardLayouts.tenantId, tenantId));
    const keys = new Map((await this.roles.list(tx, tenantId)).map((role) => [role.id, role.key]));
    return Object.fromEntries(
      rows.flatMap((row) =>
        row.cards && keys.has(row.roleId) ? [[keys.get(row.roleId)!, row.cards]] : [],
      ),
    );
  }

  /** A template's layouts at provisioning, by role key, already checked with the template. */
  async applyTemplate(
    tx: TenantTx,
    tenantId: string,
    dashboards: Readonly<Record<string, DashboardCard[]>> | undefined,
  ): Promise<void> {
    if (!dashboards) return;
    const ids = new Map((await this.roles.list(tx, tenantId)).map((role) => [role.key, role.id]));
    for (const [key, cards] of Object.entries(dashboards)) {
      const roleId = ids.get(key);
      if (roleId) await tx.insert(dashboardLayouts).values({ tenantId, roleId, cards });
    }
  }

  /** A role's cards, or null for the standard Home. */
  async forRole(tx: TenantTx, tenantId: string, roleId: string): Promise<DashboardCard[] | null> {
    const [row] = await tx
      .select({ cards: dashboardLayouts.cards })
      .from(dashboardLayouts)
      .where(and(eq(dashboardLayouts.tenantId, tenantId), eq(dashboardLayouts.roleId, roleId)));
    return row?.cards ?? null;
  }

  /**
   * The layout the caller's Home follows: their role's, while the module is on; vendor support and
   * API clients keep the standard Home.
   */
  async forCaller(tx: TenantTx, access: Access): Promise<DashboardCard[] | null> {
    if (access.support || access.apiClient) return null;
    const { modulesOff } = await this.config.settings(tx, access.tenantId);
    if (modulesOff.includes('advanced_analytics')) return null;
    return this.forRole(tx, access.tenantId, access.roleId);
  }
}
