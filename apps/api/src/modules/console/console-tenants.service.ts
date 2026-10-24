import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CellSummary,
  type ConsoleTenant,
  type ConsoleTenantQuery,
  type CreateTenantBody,
  type TemplateSummary,
  type TenantStatus,
} from '@thelamp/shared';
import { loadTemplate, TEMPLATE_KEYS } from '@thelamp/templates';
import { and, asc, eq, gt, ilike, or, sql, type SQL } from 'drizzle-orm';
import { cells, memberships, tenants } from '../../db/schema/directory';
import type { StaffAccess } from '../../platform/auth';
import { DirectoryDatabase } from '../directory/directory.database';
import { TenantProvisioner } from '../provisioning/provisioner';
import { PlatformAudit } from './platform-audit';

const DAY = 86_400_000;

const notFound = () => new AppError('NOT_FOUND', 'There is no such tenant.');

/**
 * Tenants as the console sees them (module M22, decision D88): every tenant in the directory with
 * its cell, template, trial and active users; created from a template with the first admin, and
 * suspended or reactivated. Suspending closes the tenant on everyone's next request (BR-39).
 */
@Injectable()
export class ConsoleTenantsService {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly provisioner: TenantProvisioner,
    private readonly audit: PlatformAudit,
  ) {}

  async list(
    query: ConsoleTenantQuery,
  ): Promise<{ items: ConsoleTenant[]; nextCursor: string | null }> {
    const conditions: (SQL | undefined)[] = [
      query.status ? eq(tenants.status, query.status) : undefined,
      query.q
        ? or(ilike(tenants.name, `%${like(query.q)}%`), ilike(tenants.slug, `%${like(query.q)}%`))
        : undefined,
      query.cursor ? gt(tenants.slug, query.cursor) : undefined,
    ];
    const rows = await this.rows(and(...conditions), query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      items: page,
      nextCursor: rows.length > query.limit ? page.at(-1)!.slug : null,
    };
  }

  async get(id: string): Promise<ConsoleTenant> {
    const [row] = await this.rows(eq(tenants.id, id), 1);
    if (!row) throw notFound();
    return row;
  }

  /**
   * Creates a tenant from a template with its first admin, on this cell. The console names it,
   * so the same create again answers with the same tenant.
   */
  async create(by: StaffAccess, body: CreateTenantBody): Promise<ConsoleTenant> {
    const [existing] = await this.database.db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, body.id));
    if (existing) {
      if (existing.slug !== body.slug) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'This ID was used for another tenant.');
      }
      return this.get(body.id);
    }
    const { id, trialDays, ...input } = body;
    await this.provisioner.provision(input, undefined, {
      tenantId: id,
      ...(input.status === 'trial' ? { trialEndsAt: new Date(Date.now() + trialDays * DAY) } : {}),
    });
    await this.database.db.transaction((tx) =>
      this.audit.record(tx, by, 'tenant.created', 'tenant', id, {
        slug: input.slug,
        template: input.template,
        status: input.status,
      }),
    );
    return this.get(id);
  }

  /** Closes the tenant: nobody signs in, and every session ends on its next request. */
  async suspend(by: StaffAccess, id: string, reason: string): Promise<ConsoleTenant> {
    return this.move(by, id, 'tenant.suspended', { reason }, (status) => {
      if (status === 'terminated') {
        throw new AppError('CONFLICT', 'A terminated tenant can’t be suspended.');
      }
      return 'suspended';
    });
  }

  /** Opens a suspended tenant again: on trial while its trial lasts, otherwise active. */
  async reactivate(by: StaffAccess, id: string): Promise<ConsoleTenant> {
    return this.move(by, id, 'tenant.reactivated', {}, (status, trialEndsAt) => {
      if (status !== 'suspended') {
        throw new AppError('CONFLICT', 'Only a suspended tenant can be reactivated.');
      }
      return trialEndsAt && trialEndsAt.getTime() > Date.now() ? 'trial' : 'active';
    });
  }

  templates(): TemplateSummary[] {
    return TEMPLATE_KEYS.map((key) => {
      const template = loadTemplate(key);
      return {
        key: template.key,
        version: template.version,
        name: template.name,
        description: template.description,
      };
    });
  }

  async cells(): Promise<CellSummary[]> {
    const rows = await this.database.db
      .select({
        name: cells.name,
        region: cells.region,
        kind: cells.kind,
        status: cells.status,
        capacityUsers: cells.capacityUsers,
        tenants: sql<number>`(select count(*)::int from ${tenants} where ${tenants.cellId} = ${cells.id})`,
      })
      .from(cells)
      .orderBy(asc(cells.name));
    return rows;
  }

  private async move(
    by: StaffAccess,
    id: string,
    action: string,
    detail: Record<string, unknown>,
    next: (status: TenantStatus, trialEndsAt: Date | null) => TenantStatus,
  ): Promise<ConsoleTenant> {
    await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: tenants.status, trialEndsAt: tenants.trialEndsAt })
        .from(tenants)
        .where(eq(tenants.id, id))
        .for('update');
      if (!row) throw notFound();
      const status = next(row.status, row.trialEndsAt);
      // Already there: the same request again changes nothing.
      if (status === row.status) return;
      await tx.update(tenants).set({ status }).where(eq(tenants.id, id));
      await this.audit.record(tx, by, action, 'tenant', id, {
        ...detail,
        before: row.status,
        after: status,
      });
    });
    return this.get(id);
  }

  private async rows(where: SQL | undefined, limit: number): Promise<ConsoleTenant[]> {
    const rows = await this.database.db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        status: tenants.status,
        templateKey: tenants.templateKey,
        templateVersion: tenants.templateVersion,
        trialEndsAt: tenants.trialEndsAt,
        demo: tenants.demo,
        createdAt: tenants.createdAt,
        cellName: cells.name,
        cellRegion: cells.region,
        cellKind: cells.kind,
        activeUsers: sql<number>`(select count(*)::int from ${memberships} where ${memberships.tenantId} = ${tenants.id} and ${memberships.status} = 'active')`,
      })
      .from(tenants)
      .innerJoin(cells, eq(cells.id, tenants.cellId))
      .where(where)
      .orderBy(asc(tenants.slug))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      cell: { name: row.cellName, region: row.cellRegion, kind: row.cellKind },
      template: { key: row.templateKey, version: row.templateVersion },
      trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
      demo: row.demo,
      activeUsers: row.activeUsers,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

/** A search term with LIKE's wildcards taken literally. */
function like(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}
