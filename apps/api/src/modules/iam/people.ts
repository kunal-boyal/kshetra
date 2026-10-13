import { Injectable } from '@nestjs/common';
import type { TenantPermission, UserStatus } from '@kshetra/shared';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { designations, roles, users } from '../../db/schema/iam';
import type { TenantTx } from '../../platform/database';

/** What other modules may know of a person, whatever the caller's scope: no contact details. */
export interface PersonFacts {
  id: string;
  code: string;
  name: string;
  designation: string;
  status: UserStatus;
  managerId: string | null;
}

/**
 * People as other modules see them: who fills an account's slot, who approves a request. It reads
 * only what those modules need, so they never reach the IAM tables themselves.
 */
@Injectable()
export class People {
  private select(tx: TenantTx) {
    return tx
      .select({
        id: users.id,
        code: users.code,
        name: users.name,
        designation: designations.key,
        status: users.status,
        managerId: users.managerId,
      })
      .from(users)
      .innerJoin(
        designations,
        and(eq(designations.tenantId, users.tenantId), eq(designations.id, users.designationId)),
      );
  }

  /** The people with these IDs, by ID; an ID of nobody is left out. */
  async facts(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, PersonFacts>> {
    if (ids.length === 0) return new Map();
    const found = await this.select(tx).where(
      and(eq(users.tenantId, tenantId), inArray(users.id, [...new Set(ids)])),
    );
    return new Map(found.map((person) => [person.id, person]));
  }

  /**
   * When each person works for the tenant, for attendance days (BR-23): everyone active, or the
   * people named. Deactivated people keep their past days; they get no new ones.
   */
  async employment(
    tx: TenantTx,
    tenantId: string,
    ids?: readonly string[],
  ): Promise<{ id: string; joiningDate: string | null; exitDate: string | null }[]> {
    return tx
      .select({ id: users.id, joiningDate: users.joiningDate, exitDate: users.exitDate })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          ids ? inArray(users.id, [...new Set(ids)]) : eq(users.status, 'active'),
        ),
      );
  }

  /** Everyone in the tenant, by code, for files that name people (BR-42). */
  async everyone(tx: TenantTx, tenantId: string): Promise<PersonFacts[]> {
    return this.select(tx).where(eq(users.tenantId, tenantId)).orderBy(asc(users.code));
  }

  /**
   * The active people, other than `except`, whose role grants a permission across the tenant: who
   * decides when a request has no one nearer (decision D38).
   */
  async holding(
    tx: TenantTx,
    tenantId: string,
    permission: TenantPermission,
    except: string,
  ): Promise<string[]> {
    const found = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, and(eq(roles.tenantId, users.tenantId), eq(roles.id, users.roleId)))
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.status, 'active'),
          ne(users.id, except),
          eq(roles.scope, 'tenant'),
          sql`${permission} = any(${roles.permissions})`,
        ),
      )
      .orderBy(asc(users.code));
    return found.map((row) => row.id);
  }
}
