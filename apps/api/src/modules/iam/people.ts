import { Injectable } from '@nestjs/common';
import type { LocalizedNoun, TenantPermission, UserStatus } from '@thelamp/shared';
import type { z } from 'zod';
import { and, asc, eq, gte, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import { designations, devices, reportingClosure, roles, users } from '../../db/schema/iam';
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
   * A person's managers up the reporting tree, nearest first, with how far up each is: depth 1 is
   * their manager. Approval chains route by it (spec 5.9).
   */
  async ancestors(
    tx: TenantTx,
    tenantId: string,
    userId: string,
  ): Promise<(PersonFacts & { depth: number })[]> {
    return tx
      .select({
        id: users.id,
        code: users.code,
        name: users.name,
        designation: designations.key,
        status: users.status,
        managerId: users.managerId,
        depth: reportingClosure.depth,
      })
      .from(reportingClosure)
      .innerJoin(
        users,
        and(
          eq(users.tenantId, reportingClosure.tenantId),
          eq(users.id, reportingClosure.ancestorId),
        ),
      )
      .innerJoin(
        designations,
        and(eq(designations.tenantId, users.tenantId), eq(designations.id, users.designationId)),
      )
      .where(
        and(
          eq(reportingClosure.tenantId, tenantId),
          eq(reportingClosure.descendantId, userId),
          gte(reportingClosure.depth, 1),
        ),
      )
      .orderBy(asc(reportingClosure.depth));
  }

  /**
   * When each person works for the tenant, and the holiday calendar they keep, for attendance days
   * (BR-23): everyone active, or the people named. Deactivated people keep their past days; they get no new ones.
   */
  async employment(
    tx: TenantTx,
    tenantId: string,
    ids?: readonly string[],
  ): Promise<
    {
      id: string;
      joiningDate: string | null;
      exitDate: string | null;
      calendarKey: string | null;
    }[]
  > {
    return tx
      .select({
        id: users.id,
        joiningDate: users.joiningDate,
        exitDate: users.exitDate,
        calendarKey: users.calendarKey,
      })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          ids ? inArray(users.id, [...new Set(ids)]) : eq(users.status, 'active'),
        ),
      );
  }

  /**
   * Keeps a person on a holiday calendar (M13), or on the tenant's default with null. The field
   * module, which owns calendars, checks the key; returns the key before, or undefined when there
   * is no such person.
   */
  async setCalendar(
    tx: TenantTx,
    tenantId: string,
    id: string,
    calendarKey: string | null,
  ): Promise<string | null | undefined> {
    const [before] = await tx
      .select({ calendarKey: users.calendarKey })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)))
      .for('update');
    if (!before) return undefined;
    await tx
      .update(users)
      .set({ calendarKey, updatedAt: new Date() })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
    return before.calendarKey;
  }

  /** Everyone in the tenant, by code, for files that name people (BR-42). */
  async everyone(tx: TenantTx, tenantId: string): Promise<PersonFacts[]> {
    return this.select(tx).where(eq(users.tenantId, tenantId)).orderBy(asc(users.code));
  }

  /**
   * The active people a condition on `users` holds for, by name: a caller's reach, from
   * `Scopes.users()`.
   */
  async matching(tx: TenantTx, tenantId: string, condition: SQL): Promise<PersonFacts[]> {
    return this.select(tx)
      .where(and(eq(users.tenantId, tenantId), eq(users.status, 'active'), condition))
      .orderBy(asc(users.name), asc(users.id));
  }

  /**
   * The people a report covers (M18): those `ids` selects who were employed on or after `from`, so
   * a past month keeps whoever left during it; by code.
   */
  async among(tx: TenantTx, tenantId: string, ids: SQL, from: string): Promise<PersonFacts[]> {
    return this.select(tx)
      .where(
        and(
          eq(users.tenantId, tenantId),
          sql`${users.id} in (${ids})`,
          or(eq(users.status, 'active'), isNull(users.exitDate), gte(users.exitDate, from)),
        ),
      )
      .orderBy(asc(users.code), asc(users.id));
  }

  /**
   * How to reach these people outside the app, for notifications (M16): their number and email,
   * active people only. Never logged.
   */
  async contacts(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, { phone: string | null; email: string | null }>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: users.id, phone: users.phoneE164, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.status, 'active'),
          inArray(users.id, [...new Set(ids)]),
        ),
      );
    return new Map(rows.map((row) => [row.id, { phone: row.phone, email: row.email }]));
  }

  /** The ranking groups (D8): one per designation marked ranked, highest level first. */
  async rankingGroups(
    tx: TenantTx,
    tenantId: string,
  ): Promise<{ key: string; name: z.output<typeof LocalizedNoun> }[]> {
    return tx
      .select({ key: designations.key, name: designations.name })
      .from(designations)
      .where(and(eq(designations.tenantId, tenantId), eq(designations.ranked, true)))
      .orderBy(asc(designations.level), asc(designations.key));
  }

  /** The active people with a designation: one ranking group (D8). */
  async withDesignation(
    tx: TenantTx,
    tenantId: string,
    designation: string,
  ): Promise<PersonFacts[]> {
    return this.select(tx)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.status, 'active'),
          eq(designations.key, designation),
        ),
      )
      .orderBy(asc(users.code));
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

  /**
   * Anonymises a deactivated person (decision D95): their name gives way to "Former employee"
   * and their code, their phone number, email and custom fields go, and their phones forget their
   * push tokens. Everything they did keeps pointing at this row, so the records stay whole.
   */
  async anonymise(tx: TenantTx, tenantId: string, userId: string): Promise<void> {
    const [person] = await tx
      .select({ code: users.code, status: users.status })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
      .for('update');
    if (!person) throw new Error(`There is no person ${userId}.`);
    if (person.status === 'active') throw new Error('An active person is not erased.');
    await tx
      .update(users)
      .set({
        name: `Former employee ${person.code}`,
        phoneE164: null,
        email: null,
        custom: {},
        authRevision: sql`${users.authRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
    await tx
      .update(devices)
      .set({ pushToken: null })
      .where(and(eq(devices.tenantId, tenantId), eq(devices.userId, userId)));
  }
}
