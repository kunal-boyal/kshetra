import { Injectable } from '@nestjs/common';
import { AppError, newId, type LocalizedNoun } from '@kshetra/shared';
import { and, eq, type SQL, sql } from 'drizzle-orm';
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
