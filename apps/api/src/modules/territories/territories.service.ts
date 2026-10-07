import { Injectable } from '@nestjs/common';
import {
  AppError,
  issueAt,
  newId,
  type LocalizedNoun,
  type TerritoryListQuery,
  type TerritoryRef,
  type TerritoryResult,
} from '@kshetra/shared';
import { and, asc, eq, gt, inArray, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  territories,
  territoryClosure,
  territoryLevels,
  userTerritories,
} from '../../db/schema/territories';
import type { TenantTx } from '../../platform/database';

export interface NewTerritory {
  code: string;
  name: string;
  /** Null for a node at the top level. */
  parentId: string | null;
}

/**
 * The territory tree (spec 5.4) and its closure, which access checks use to reach everything under
 * a user's territories (spec 4.2). Managing territories over HTTP arrives with module M4.
 */
@Injectable()
export class TerritoriesService {
  /** The tenant's geography levels, highest first, as its template names them. */
  async applyLevels(
    tx: TenantTx,
    tenantId: string,
    levels: readonly { key: string; name: z.output<typeof LocalizedNoun> }[],
  ): Promise<void> {
    await tx
      .insert(territoryLevels)
      .values(levels.map((level, index) => ({ tenantId, level: index + 1, ...level })));
  }

  /** Adds a node one level below its parent, and its closure rows. */
  async create(
    tx: TenantTx,
    tenantId: string,
    input: NewTerritory,
    actorId: string | null,
  ): Promise<string> {
    let level = 1;
    if (input.parentId) {
      const [parent] = await tx
        .select({ level: territories.level })
        .from(territories)
        .where(and(eq(territories.tenantId, tenantId), eq(territories.id, input.parentId)));
      if (!parent) {
        throw new AppError('VALIDATION', 'Choose a parent territory that exists.', [
          { path: 'parentId', issue: 'There is no territory with this ID' },
        ]);
      }
      level = parent.level + 1;
    }
    const [known] = await tx
      .select({ level: territoryLevels.level })
      .from(territoryLevels)
      .where(and(eq(territoryLevels.tenantId, tenantId), eq(territoryLevels.level, level)));
    if (!known) {
      throw new AppError('VALIDATION', 'The geography has no level this deep.', [
        { path: 'parentId', issue: 'A territory here would be below the lowest level' },
      ]);
    }

    const id = newId();
    await tx.insert(territories).values({
      id,
      tenantId,
      level,
      parentId: input.parentId,
      code: input.code,
      name: input.name,
      createdBy: actorId,
      updatedBy: actorId,
    });
    await tx.execute(sql`
      insert into ${territoryClosure} (tenant_id, ancestor_id, descendant_id, depth)
      select ${tenantId}::uuid, ${id}::uuid, ${id}::uuid, 0
      union all
      select tenant_id, ancestor_id, ${id}::uuid, depth + 1
        from ${territoryClosure}
       where tenant_id = ${tenantId} and descendant_id = ${input.parentId}`);
    return id;
  }

  /** The tree, highest level first, for pickers and filters. */
  async list(
    tx: TenantTx,
    tenantId: string,
    query: TerritoryListQuery,
  ): Promise<TerritoryResult[]> {
    return tx
      .select({
        id: territories.id,
        parentId: territories.parentId,
        level: territories.level,
        code: territories.code,
        name: territories.name,
        active: territories.active,
      })
      .from(territories)
      .where(
        and(
          eq(territories.tenantId, tenantId),
          query.active === undefined ? undefined : eq(territories.active, query.active),
        ),
      )
      .orderBy(asc(territories.level), asc(territories.code));
  }

  /** The territories each user is attached to on `day`, by user. */
  async attachmentsOf(
    tx: TenantTx,
    tenantId: string,
    userIds: readonly string[],
    day: string,
  ): Promise<Map<string, TerritoryRef[]>> {
    const found = new Map<string, TerritoryRef[]>();
    if (userIds.length === 0) return found;
    const rows = await tx
      .select({
        userId: userTerritories.userId,
        id: territories.id,
        code: territories.code,
        name: territories.name,
      })
      .from(userTerritories)
      .innerJoin(
        territories,
        and(
          eq(territories.tenantId, userTerritories.tenantId),
          eq(territories.id, userTerritories.territoryId),
        ),
      )
      .where(
        and(
          eq(userTerritories.tenantId, tenantId),
          inArray(userTerritories.userId, [...userIds]),
          validOn(day),
        ),
      )
      .orderBy(asc(territories.code));
    for (const { userId, ...territory } of rows) {
      found.set(userId, [...(found.get(userId) ?? []), territory]);
    }
    return found;
  }

  /** Refuses IDs that name no active territory, each at its place in `path`. */
  async checkTerritories(
    tx: TenantTx,
    tenantId: string,
    territoryIds: readonly string[],
    path: readonly PropertyKey[] = ['territoryIds'],
  ): Promise<void> {
    if (territoryIds.length === 0) return;
    const active = new Set(
      (
        await tx
          .select({ id: territories.id })
          .from(territories)
          .where(
            and(
              eq(territories.tenantId, tenantId),
              inArray(territories.id, [...new Set(territoryIds)]),
              eq(territories.active, true),
            ),
          )
      ).map((row) => row.id),
    );
    const issues = territoryIds.flatMap((id, index) =>
      active.has(id)
        ? []
        : [issueAt([...path, index], 'There is no active territory with this ID')],
    );
    if (issues.length > 0) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', issues);
    }
  }

  /**
   * Makes `territoryIds` the user's territories from `from` on (spec 5.4): attachments that end
   * stop the day before, new ones start that day, and the ones that stay are left alone. Every ID
   * must name an active territory, or the change fails at `path`.
   */
  async replaceAttachments(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    territoryIds: readonly string[],
    from: string,
    path: readonly PropertyKey[] = ['territoryIds'],
  ): Promise<void> {
    await this.checkTerritories(tx, tenantId, territoryIds, path);
    const wanted = [...new Set(territoryIds)];
    // What applies on `from` or starts later.
    const current = await tx
      .select({ territoryId: userTerritories.territoryId, validFrom: userTerritories.validFrom })
      .from(userTerritories)
      .where(
        and(
          eq(userTerritories.tenantId, tenantId),
          eq(userTerritories.userId, userId),
          or(isNull(userTerritories.validTo), gt(userTerritories.validTo, from)),
        ),
      );
    const kept = new Set<string>();
    for (const attachment of current) {
      const mine = and(
        eq(userTerritories.tenantId, tenantId),
        eq(userTerritories.userId, userId),
        eq(userTerritories.territoryId, attachment.territoryId),
        eq(userTerritories.validFrom, attachment.validFrom),
      );
      if (wanted.includes(attachment.territoryId) && attachment.validFrom <= from) {
        kept.add(attachment.territoryId);
      } else if (attachment.validFrom < from) {
        await tx.update(userTerritories).set({ validTo: from }).where(mine);
      } else {
        // An attachment that hasn't started yet never applied, so it goes rather than ending
        // before it began.
        await tx.delete(userTerritories).where(mine);
      }
    }
    const added = wanted.filter((id) => !kept.has(id));
    if (added.length > 0) {
      await tx
        .insert(userTerritories)
        .values(added.map((territoryId) => ({ tenantId, userId, territoryId, validFrom: from })));
    }
  }

  /** Attaches a user to a territory from a date on (spec 5.4). */
  async attach(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    territoryId: string,
    validFrom: string,
  ): Promise<void> {
    await tx.insert(userTerritories).values({ tenantId, userId, territoryId, validFrom });
  }

  /**
   * The users attached on `today` (`YYYY-MM-DD`, the tenant's date) to any territory at or below
   * one the given user is attached to on that day: whom a `territory` scope reaches (spec 4.2).
   * A subquery that selects user IDs.
   */
  usersReachedBy(tenantId: string, userId: string, today: string): SQL {
    return sql`
      select theirs.user_id
        from ${userTerritories} mine
        join ${territoryClosure} tree
          on tree.tenant_id = mine.tenant_id and tree.ancestor_id = mine.territory_id
        join ${userTerritories} theirs
          on theirs.tenant_id = tree.tenant_id and theirs.territory_id = tree.descendant_id
       where mine.tenant_id = ${tenantId}
         and mine.user_id = ${userId}
         and mine.valid_from <= ${today}::date
         and (mine.valid_to is null or mine.valid_to > ${today}::date)
         and theirs.valid_from <= ${today}::date
         and (theirs.valid_to is null or theirs.valid_to > ${today}::date)`;
  }
}

/** Attachments that apply on `day`: `valid_to` is the first day one no longer applies. */
function validOn(day: string): SQL {
  return and(
    lte(userTerritories.validFrom, day),
    or(isNull(userTerritories.validTo), gt(userTerritories.validTo, day)),
  )!;
}
