import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CreateTerritoryBody,
  issueAt,
  newId,
  type LocalizedNoun,
  type TerritoryLevel,
  type TerritoryListQuery,
  type TerritoryRef,
  type TerritoryResult,
  todayIn,
  type UpdateTerritoryBody,
} from '@kshetra/shared';
import { and, asc, eq, gt, inArray, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  territories,
  territoryClosure,
  territoryLevels,
  userTerritories,
} from '../../db/schema/territories';
import { type AuditActor, AuditLog } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

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
const notFound = () => new AppError('NOT_FOUND', 'This was not found.');
const invalid = (path: string, issue: string) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', [{ path, issue }]);

const RESULT = {
  id: territories.id,
  parentId: territories.parentId,
  level: territories.level,
  code: territories.code,
  name: territories.name,
  active: territories.active,
};

/** Whether a database error is the territory code's unique index. */
function codeTaken(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ('code' in current && current.code === '23505') return true;
  }
  return false;
}

@Injectable()
export class TerritoriesService {
  constructor(
    private readonly audit: AuditLog,
    private readonly config: TenantConfigService,
  ) {}

  /** The tenant's geography levels, highest first (spec 5.4). */
  async levels(tx: TenantTx, tenantId: string): Promise<TerritoryLevel[]> {
    return tx
      .select({
        level: territoryLevels.level,
        key: territoryLevels.key,
        name: territoryLevels.name,
      })
      .from(territoryLevels)
      .where(eq(territoryLevels.tenantId, tenantId))
      .orderBy(asc(territoryLevels.level));
  }

  async get(tx: TenantTx, tenantId: string, id: string): Promise<TerritoryResult> {
    const [row] = await tx
      .select(RESULT)
      .from(territories)
      .where(and(eq(territories.tenantId, tenantId), eq(territories.id, id)));
    if (!row) throw notFound();
    return row;
  }

  /** Adds a node under an active parent, or at the top (M4). */
  async add(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    input: CreateTerritoryBody,
  ): Promise<TerritoryResult> {
    if (input.parentId) {
      const parent = await this.get(tx, tenantId, input.parentId).catch(() => null);
      if (!parent) throw invalid('parentId', 'There is no territory with this ID');
      if (!parent.active) throw invalid('parentId', 'This territory is switched off');
    }
    let id: string;
    try {
      id = await tx.transaction((inner) =>
        this.create(inner, tenantId, input, actor.kind === 'user' ? actor.id : null),
      );
    } catch (error) {
      if (codeTaken(error)) {
        throw new AppError('CONFLICT', 'Another territory already has this code.', [
          { path: 'code', issue: 'Another territory has this code' },
        ]);
      }
      throw error;
    }
    const created = await this.get(tx, tenantId, id);
    await this.audit.record(tx, tenantId, actor, {
      action: 'territory.created',
      target: { type: 'territory', id },
      after: created,
    });
    return created;
  }

  /**
   * Renames, recodes, moves or switches a node off or on (M4). A node moves only to another
   * parent at the same level, so its own level and everything below it stay as they are. A node
   * switches off only when nothing under it is on and nobody works in it today; it switches back
   * on only under a parent that is on.
   */
  async change(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    id: string,
    input: UpdateTerritoryBody,
  ): Promise<TerritoryResult> {
    const [current] = await tx
      .select(RESULT)
      .from(territories)
      .where(and(eq(territories.tenantId, tenantId), eq(territories.id, id)))
      .for('update');
    if (!current) throw notFound();

    const moving = input.parentId !== undefined && input.parentId !== current.parentId;
    if (moving) {
      if (current.parentId === null) {
        throw invalid('parentId', 'A territory at the top level has no parent to change');
      }
      const parent = await this.get(tx, tenantId, input.parentId!).catch(() => null);
      if (!parent) throw invalid('parentId', 'There is no territory with this ID');
      if (parent.level !== current.level - 1) {
        throw invalid('parentId', 'Choose a parent at the same level as the current one');
      }
      if (!parent.active) throw invalid('parentId', 'This territory is switched off');
    }
    if (input.active === false && current.active) {
      const [child] = await tx
        .select({ id: territories.id })
        .from(territories)
        .where(
          and(
            eq(territories.tenantId, tenantId),
            eq(territories.parentId, id),
            eq(territories.active, true),
          ),
        )
        .limit(1);
      if (child) {
        throw new AppError('CONFLICT', 'Switch off the territories under it first.', [
          { path: 'active', issue: 'Territories under it are still on' },
        ]);
      }
      const today = todayIn((await this.config.settings(tx, tenantId)).timezone);
      const [someone] = await tx
        .select({ userId: userTerritories.userId })
        .from(userTerritories)
        .where(
          and(
            eq(userTerritories.tenantId, tenantId),
            eq(userTerritories.territoryId, id),
            validOn(today),
          ),
        )
        .limit(1);
      if (someone) {
        throw new AppError('CONFLICT', 'People work in this territory. Move them first.', [
          { path: 'active', issue: 'People work in this territory' },
        ]);
      }
    }
    if (input.active === true && !current.active && current.parentId) {
      const parent = await this.get(tx, tenantId, current.parentId);
      if (!parent.active) {
        throw invalid('active', 'Switch the territory above it on first');
      }
    }

    const changes = {
      ...(input.code !== undefined && input.code !== current.code ? { code: input.code } : {}),
      ...(input.name !== undefined && input.name !== current.name ? { name: input.name } : {}),
      ...(moving ? { parentId: input.parentId! } : {}),
      ...(input.active !== undefined && input.active !== current.active
        ? { active: input.active }
        : {}),
    };
    if (Object.keys(changes).length === 0) return current;
    try {
      await tx.transaction((inner) =>
        inner
          .update(territories)
          .set({
            ...changes,
            updatedAt: new Date(),
            updatedBy: actor.kind === 'user' ? actor.id : null,
          })
          .where(and(eq(territories.tenantId, tenantId), eq(territories.id, id))),
      );
    } catch (error) {
      if (codeTaken(error)) {
        throw new AppError('CONFLICT', 'Another territory already has this code.', [
          { path: 'code', issue: 'Another territory has this code' },
        ]);
      }
      throw error;
    }
    if (moving) await this.moveClosure(tx, tenantId, id, input.parentId!);
    const after = await this.get(tx, tenantId, id);
    await this.audit.record(tx, tenantId, actor, {
      action: 'territory.updated',
      target: { type: 'territory', id },
      before: current,
      after,
    });
    return after;
  }

  /** Re-links a node and everything under it to its new parent's ancestors. */
  private async moveClosure(tx: TenantTx, tenantId: string, id: string, parentId: string) {
    // Links from outside the subtree into it go; links within it stay.
    await tx.execute(sql`
      delete from ${territoryClosure} link
       where link.tenant_id = ${tenantId}
         and link.descendant_id in (select descendant_id from ${territoryClosure}
                                     where tenant_id = ${tenantId} and ancestor_id = ${id})
         and link.ancestor_id not in (select descendant_id from ${territoryClosure}
                                       where tenant_id = ${tenantId} and ancestor_id = ${id})`);
    await tx.execute(sql`
      insert into ${territoryClosure} (tenant_id, ancestor_id, descendant_id, depth)
      select ${tenantId}::uuid, up.ancestor_id, down.descendant_id, up.depth + down.depth + 1
        from ${territoryClosure} up
        join ${territoryClosure} down on down.tenant_id = up.tenant_id
       where up.tenant_id = ${tenantId} and up.descendant_id = ${parentId}
         and down.ancestor_id = ${id}`);
  }
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
