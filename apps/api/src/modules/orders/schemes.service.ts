import { Injectable } from '@nestjs/common';
import {
  AppError,
  type ErrorDetail,
  type SchemeBody,
  type SchemeKindValue,
  type SchemeRef,
  type SchemeResult,
  schemeRuleIssues,
} from '@thelamp/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schemes } from '../../db/schema/schemes';
import { type AuditActor, AuditLog } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { AccountTypesService } from '../accounts/account-types.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { TerritoriesService } from '../territories/territories.service';

const invalid = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', issues);

type Row = typeof schemes.$inferSelect;

const resultOf = (row: Row): SchemeResult => ({
  id: row.id,
  key: row.key,
  name: row.name as SchemeResult['name'],
  kind: row.kind as SchemeKindValue,
  rule: row.rule as SchemeResult['rule'],
  itemIds: row.itemIds,
  categoryIds: row.categoryIds,
  accountTypeKeys: row.accountTypeKeys,
  territoryIds: row.territoryIds,
  validFrom: row.validFrom,
  validTo: row.validTo,
  active: row.active,
  version: row.version,
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Schemes and promotions on orders (BR-55, decision D127): kept by those who manage them, applied
 * by `OrdersService.place()` through `chooseSchemes()` in `@thelamp/shared`, as the phones and the
 * order desk work them out too. A scheme's key never changes; it is switched off, never removed.
 */
@Injectable()
export class SchemesService {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly accountTypes: AccountTypesService,
    private readonly territories: TerritoriesService,
    private readonly audit: AuditLog,
  ) {}

  async list(tx: TenantTx, tenantId: string): Promise<SchemeResult[]> {
    const rows = await tx
      .select()
      .from(schemes)
      .where(eq(schemes.tenantId, tenantId))
      .orderBy(sql`${schemes.active} desc`, asc(schemes.validFrom), asc(schemes.key));
    return rows.map(resultOf);
  }

  async get(tx: TenantTx, tenantId: string, id: string): Promise<SchemeResult> {
    const [row] = await tx
      .select()
      .from(schemes)
      .where(and(eq(schemes.tenantId, tenantId), eq(schemes.id, id)));
    if (!row) throw new AppError('NOT_FOUND', 'There is no scheme with this ID.');
    return resultOf(row);
  }

  /** Every scheme as the pricing rules read it; `schemeApplies()` judges dates and switches. */
  async refs(tx: TenantTx, tenantId: string): Promise<SchemeRef[]> {
    return (await this.list(tx, tenantId)).map((scheme) => ({
      id: scheme.id,
      key: scheme.key,
      kind: scheme.kind,
      rule: scheme.rule,
      itemIds: scheme.itemIds,
      categoryIds: scheme.categoryIds,
      accountTypeKeys: scheme.accountTypeKeys,
      territoryIds: scheme.territoryIds,
      validFrom: scheme.validFrom,
      validTo: scheme.validTo,
      active: scheme.active,
    }));
  }

  /** Adds a scheme with the caller's ID, or changes one at the version the editor saw. */
  async put(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    id: string,
    body: SchemeBody,
  ): Promise<{ scheme: SchemeResult; created: boolean }> {
    const by = actor.kind === 'user' ? actor.id : null;
    const [current] = await tx
      .select()
      .from(schemes)
      .where(and(eq(schemes.tenantId, tenantId), eq(schemes.id, id)))
      .for('update');
    if (current && body.version === undefined) {
      throw invalid([{ path: 'version', issue: 'Send the version you are changing' }]);
    }
    if (current && body.version !== current.version) {
      throw new AppError('CONFLICT', 'This scheme changed meanwhile. Read it again.');
    }
    if (current && current.key !== body.key) {
      throw invalid([{ path: 'key', issue: 'A scheme keeps its key' }]);
    }
    await this.check(tx, tenantId, id, body);
    const columns = {
      key: body.key,
      name: body.name,
      kind: body.kind,
      rule: body.rule,
      itemIds: [...new Set(body.itemIds)],
      categoryIds: [...new Set(body.categoryIds)],
      accountTypeKeys: [...new Set(body.accountTypeKeys)],
      territoryIds: [...new Set(body.territoryIds)],
      validFrom: body.validFrom,
      validTo: body.validTo,
      active: body.active,
    };
    if (current) {
      await tx
        .update(schemes)
        .set({ ...columns, version: current.version + 1, updatedAt: new Date(), updatedBy: by })
        .where(and(eq(schemes.tenantId, tenantId), eq(schemes.id, id)));
    } else {
      await tx.insert(schemes).values({ id, tenantId, ...columns, createdBy: by, updatedBy: by });
    }
    const scheme = await this.get(tx, tenantId, id);
    await this.audit.record(tx, tenantId, actor, {
      action: current ? 'scheme.updated' : 'scheme.created',
      target: { type: 'scheme', id },
      ...(current ? { before: resultOf(current) } : {}),
      after: scheme,
    });
    return { scheme, created: !current };
  }

  /** Every problem with a scheme: its rule, its key, dates, and what it names. */
  private async check(tx: TenantTx, tenantId: string, id: string, body: SchemeBody) {
    const issues: ErrorDetail[] = schemeRuleIssues(body.kind, body.rule);
    if (body.validTo && body.validTo < body.validFrom) {
      issues.push({ path: 'validTo', issue: 'End on or after the first day' });
    }
    const [taken] = await tx
      .select({ id: schemes.id })
      .from(schemes)
      .where(
        and(eq(schemes.tenantId, tenantId), eq(schemes.key, body.key), sql`${schemes.id} <> ${id}`),
      );
    if (taken) issues.push({ path: 'key', issue: 'Another scheme has this key' });
    const named = [...body.itemIds, ...(body.rule.freeItemId ? [body.rule.freeItemId] : [])];
    const items = new Set((await this.catalogue.items(tx, tenantId, named)).map((item) => item.id));
    body.itemIds.forEach((itemId, index) => {
      if (!items.has(itemId))
        issues.push({ path: `itemIds.${index}`, issue: 'There is no such item' });
    });
    if (body.rule.freeItemId && !items.has(body.rule.freeItemId)) {
      issues.push({ path: 'rule.freeItemId', issue: 'There is no such item' });
    }
    const categories = await this.catalogue.categoryIds(tx, tenantId, body.categoryIds);
    body.categoryIds.forEach((categoryId, index) => {
      if (!categories.has(categoryId)) {
        issues.push({ path: `categoryIds.${index}`, issue: 'There is no such category' });
      }
    });
    const types = new Set((await this.accountTypes.list(tx, tenantId)).map((type) => type.key));
    body.accountTypeKeys.forEach((key, index) => {
      if (!types.has(key)) {
        issues.push({
          path: `accountTypeKeys.${index}`,
          issue: 'There is no account type with this key',
        });
      }
    });
    const territories = await this.territories.byIds(tx, tenantId, body.territoryIds);
    body.territoryIds.forEach((territoryId, index) => {
      if (!territories.has(territoryId)) {
        issues.push({ path: `territoryIds.${index}`, issue: 'There is no territory with this ID' });
      }
    });
    if (issues.length > 0) throw invalid(issues);
  }
}
