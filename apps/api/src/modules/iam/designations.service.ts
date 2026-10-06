import { Injectable } from '@nestjs/common';
import {
  AppError,
  type DesignationDefinition,
  type DesignationResult,
  newId,
  type UpdateDesignationBody,
} from '@kshetra/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { designations, roles, users } from '../../db/schema/iam';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { type Actor, actorId, invalid, notFound, uniqueViolation } from './actor';

const selection = {
  id: designations.id,
  key: designations.key,
  name: designations.name,
  level: designations.level,
  defaultRole: roles.key,
  canHaveReports: designations.canHaveReports,
  ranked: designations.ranked,
};

/** Designations (spec 5.3): job titles with a level. They grant no permissions themselves. */
@Injectable()
export class DesignationsService {
  async list(tx: TenantTx, tenantId: string): Promise<DesignationResult[]> {
    return this.query(tx)
      .where(eq(designations.tenantId, tenantId))
      .orderBy(asc(designations.level), asc(designations.key));
  }

  async create(
    tx: TenantTx,
    tenantId: string,
    actor: Actor,
    input: DesignationDefinition,
  ): Promise<DesignationResult> {
    const defaultRoleId = await this.roleId(tx, tenantId, input.defaultRole);
    const [taken] = await tx
      .select({ id: designations.id })
      .from(designations)
      .where(and(eq(designations.tenantId, tenantId), eq(designations.key, input.key)));
    if (taken) throw keyTaken();
    const id = newId();
    const by = actorId(actor);
    try {
      await tx.insert(designations).values({
        id,
        tenantId,
        key: input.key,
        name: input.name,
        level: input.level,
        defaultRoleId,
        canHaveReports: input.canHaveReports,
        ranked: input.ranked,
        createdBy: by,
        updatedBy: by,
      });
    } catch (error) {
      if (uniqueViolation(error) === 'designations_tenant_key') throw keyTaken();
      throw error;
    }
    return this.get(tx, tenantId, id);
  }

  async update(
    tx: TenantTx,
    access: Access,
    id: string,
    input: UpdateDesignationBody,
  ): Promise<DesignationResult> {
    const [current] = await tx
      .select()
      .from(designations)
      .where(and(eq(designations.tenantId, access.tenantId), eq(designations.id, id)))
      .for('update');
    if (!current) throw notFound();
    if (input.canHaveReports === false && current.canHaveReports) {
      // Spec 5.3: a manager holds a designation that can have reports.
      const manager = alias(users, 'manager');
      const [busy] = await tx
        .select({ id: manager.id })
        .from(manager)
        .where(
          and(
            eq(manager.tenantId, access.tenantId),
            eq(manager.designationId, id),
            sql`exists (select 1 from ${users} report
                         where report.tenant_id = ${manager.tenantId}
                           and report.manager_id = ${manager.id}
                           and report.status = 'active')`,
          ),
        )
        .limit(1);
      if (busy) {
        throw new AppError(
          'CONFLICT',
          'People with this designation still have reports. Move their reports first.',
          [{ path: 'canHaveReports', issue: 'People with this designation have reports' }],
        );
      }
    }
    const changes = {
      ...(input.name ? { name: input.name } : {}),
      ...(input.level ? { level: input.level } : {}),
      ...(input.defaultRole
        ? { defaultRoleId: await this.roleId(tx, access.tenantId, input.defaultRole) }
        : {}),
      ...(input.canHaveReports === undefined ? {} : { canHaveReports: input.canHaveReports }),
      ...(input.ranked === undefined ? {} : { ranked: input.ranked }),
    };
    await tx
      .update(designations)
      .set({ ...changes, updatedAt: new Date(), updatedBy: access.userId })
      .where(and(eq(designations.tenantId, access.tenantId), eq(designations.id, id)));
    return this.get(tx, access.tenantId, id);
  }

  private async get(tx: TenantTx, tenantId: string, id: string): Promise<DesignationResult> {
    const [row] = await this.query(tx).where(
      and(eq(designations.tenantId, tenantId), eq(designations.id, id)),
    );
    if (!row) throw notFound();
    return row;
  }

  private query(tx: TenantTx) {
    return tx
      .select(selection)
      .from(designations)
      .innerJoin(
        roles,
        and(eq(roles.tenantId, designations.tenantId), eq(roles.id, designations.defaultRoleId)),
      )
      .$dynamic();
  }

  private async roleId(tx: TenantTx, tenantId: string, key: string): Promise<string> {
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, key)));
    if (!role) throw invalid('defaultRole', `There is no role \`${key}\``);
    return role.id;
  }
}

function keyTaken(): AppError {
  return new AppError('CONFLICT', 'Another designation already has this key.', [
    { path: 'key', issue: 'Already used by another designation' },
  ]);
}
