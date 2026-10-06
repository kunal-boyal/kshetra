import { Injectable } from '@nestjs/common';
import {
  AppError,
  canGrant,
  newId,
  type RoleDefinition,
  type RoleResult,
  SYSTEM_ROLES,
  type TenantPermission,
  type UpdateRoleBody,
} from '@kshetra/shared';
import { and, asc, eq } from 'drizzle-orm';
import { roles } from '../../db/schema/iam';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { type Actor, actorId, invalid, notFound, SYSTEM, uniqueViolation } from './actor';

type RoleRow = typeof roles.$inferSelect;

function toResult(row: RoleRow): RoleResult {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    scope: row.scope,
    permissions: row.permissions as TenantPermission[],
    mobileOnly: row.mobileOnly,
    system: row.system,
  };
}

const beyondOwnAccess = () =>
  new AppError('FORBIDDEN', 'A role cannot hold access that you do not have yourself.');

/**
 * Roles (spec 4.2): the six every tenant starts with, and the tenant's own. A role's permissions
 * are in the config bundle, so every change moves the config version on.
 */
@Injectable()
export class RolesService {
  constructor(private readonly config: TenantConfigService) {}

  async list(tx: TenantTx, tenantId: string): Promise<RoleResult[]> {
    const rows = await tx
      .select()
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
      .orderBy(asc(roles.id));
    return rows.map(toResult);
  }

  async create(
    tx: TenantTx,
    tenantId: string,
    actor: Actor,
    input: RoleDefinition,
  ): Promise<RoleResult> {
    if (actor !== SYSTEM && !canGrant(actor, input)) throw beyondOwnAccess();
    const [taken] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, input.key)));
    if (taken) throw keyTaken();
    const by = actorId(actor);
    try {
      const [row] = await tx
        .insert(roles)
        .values({
          id: newId(),
          tenantId,
          ...input,
          system: (SYSTEM_ROLES as readonly string[]).includes(input.key),
          createdBy: by,
          updatedBy: by,
        })
        .returning();
      await this.config.touch(tx, tenantId, by);
      return toResult(row!);
    } catch (error) {
      if (uniqueViolation(error) === 'roles_tenant_key') throw keyTaken();
      throw error;
    }
  }

  async update(
    tx: TenantTx,
    access: Access,
    id: string,
    input: UpdateRoleBody,
  ): Promise<RoleResult> {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, access.tenantId), eq(roles.id, id)))
      .for('update');
    if (!role) throw notFound();
    if (role.id === access.roleId) {
      throw new AppError('FORBIDDEN', 'You cannot change the role you hold. Ask another admin.');
    }
    if (role.key === 'tenant_admin') {
      const locked = (['permissions', 'scope', 'mobileOnly'] as const).find(
        (field) => input[field] !== undefined,
      );
      if (locked) {
        throw invalid(locked, 'The tenant admin always holds every permission across the tenant');
      }
    }
    const next = {
      name: input.name ?? role.name,
      scope: input.scope ?? role.scope,
      permissions: input.permissions ?? (role.permissions as TenantPermission[]),
      mobileOnly: input.mobileOnly ?? role.mobileOnly,
    };
    if (!canGrant(access, toResult(role)) || !canGrant(access, next)) throw beyondOwnAccess();
    const [row] = await tx
      .update(roles)
      .set({ ...next, updatedAt: new Date(), updatedBy: access.userId })
      .where(and(eq(roles.tenantId, access.tenantId), eq(roles.id, id)))
      .returning();
    await this.config.touch(tx, access.tenantId, access.userId);
    return toResult(row!);
  }
}

function keyTaken(): AppError {
  return new AppError('CONFLICT', 'Another role already has this key.', [
    { path: 'key', issue: 'Already used by another role' },
  ]);
}
