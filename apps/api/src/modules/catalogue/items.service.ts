import { Injectable } from '@nestjs/common';
import { checkValueChanges } from '@thelamp/forms';
import {
  AppError,
  type ErrorDetail,
  type ItemBody,
  type ItemResult,
  newId,
  packMeasureIssue,
  todayIn,
} from '@thelamp/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import { items, itemUnits, productCategories, products } from '../../db/schema/catalogue';
import { type AuditActor, AuditLog } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { CatalogueService } from './catalogue.service';

const lower = (text: string) => text.trim().toLowerCase();

const invalid = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', issues);

/**
 * Items as the portal edits them (spec 5.11, decision D77), and the products and categories they
 * belong to, found by name or made, as the item import does.
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  /** A category's ID by name, made when new. */
  async category(tx: TenantTx, tenantId: string, name: string): Promise<string> {
    const [found] = await tx
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(
        and(
          eq(productCategories.tenantId, tenantId),
          sql`lower(${productCategories.name}) = ${lower(name)}`,
        ),
      );
    if (found) return found.id;
    // Another request may be adding it too: whichever commits first makes it.
    await tx
      .insert(productCategories)
      .values({ id: newId(), tenantId, name: name.trim() })
      .onConflictDoNothing();
    return this.category(tx, tenantId, name);
  }

  /**
   * A product's ID by name, made when new. A category named for an existing product moves it
   * there, restamping its items so phones' copies follow; `moved` says so.
   */
  async product(
    tx: TenantTx,
    tenantId: string,
    by: string | null,
    name: string,
    categoryName: string | null,
  ): Promise<{ id: string; moved: boolean }> {
    const [found] = await tx
      .select({ id: products.id, categoryId: products.categoryId })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), sql`lower(${products.name}) = ${lower(name)}`));
    const categoryId = categoryName ? await this.category(tx, tenantId, categoryName) : null;
    if (!found) {
      // Another request may be adding it too: whichever commits first makes it.
      const id = newId();
      const made = await tx
        .insert(products)
        .values({ id, tenantId, name: name.trim(), categoryId })
        .onConflictDoNothing()
        .returning({ id: products.id });
      if (made.length > 0) return { id, moved: false };
      return this.product(tx, tenantId, by, name, categoryName);
    }
    if (!categoryId || categoryId === found.categoryId) return { id: found.id, moved: false };
    await tx
      .update(products)
      .set({ categoryId })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, found.id)));
    await tx
      .update(items)
      .set({ updatedAt: new Date(), updatedBy: by })
      .where(and(eq(items.tenantId, tenantId), eq(items.productId, found.id)));
    return { id: found.id, moved: true };
  }

  async get(tx: TenantTx, tenantId: string, id: string): Promise<ItemResult> {
    const [found] = await this.catalogue.items(tx, tenantId, [id]);
    if (!found) throw new AppError('NOT_FOUND', 'There is no item with this ID.');
    return found;
  }

  /**
   * `PUT /v1/items/{id}`: adds the item with the caller's ID, or replaces it. Units come from the
   * catalogue's settings; the measure must agree with the pack label (BR-16); item fields are
   * checked as the account type's are; the code stays unique.
   */
  async put(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    id: string,
    body: ItemBody,
  ): Promise<{ item: ItemResult; created: boolean }> {
    const by = actor.kind === 'user' ? actor.id : null;
    const settings = await this.catalogue.settings(tx, tenantId);
    const [before] = await tx
      .select({ id: items.id, custom: items.custom })
      .from(items)
      .where(and(eq(items.tenantId, tenantId), eq(items.id, id)))
      .for('update');
    const issues: ErrorDetail[] = [];
    const unitKeys = new Set(settings.units.map((unit) => unit.key));
    if (!unitKeys.has(body.baseUnit)) {
      issues.push({ path: 'baseUnit', issue: 'The catalogue has no unit with this key' });
    }
    const seen = new Set<string>([body.baseUnit]);
    body.units.forEach((unit, index) => {
      if (!unitKeys.has(unit.key)) {
        issues.push({
          path: `units.${index}.key`,
          issue: 'The catalogue has no unit with this key',
        });
      } else if (seen.has(unit.key)) {
        issues.push({
          path: `units.${index}.key`,
          issue: 'Each unit appears once, apart from the base',
        });
      }
      seen.add(unit.key);
    });
    if ((body.measureType === null) !== (body.measurePerBaseUnit === null)) {
      issues.push({
        path: body.measureType ? 'measurePerBaseUnit' : 'measureType',
        issue: 'Fill in the measure type and its amount together',
      });
    } else if (body.measureType && !settings.measureTypes.includes(body.measureType)) {
      issues.push({ path: 'measureType', issue: 'The catalogue keeps no measures of this kind' });
    } else if (body.measureType && body.measurePerBaseUnit) {
      const issue = packMeasureIssue(body.packLabel, {
        type: body.measureType,
        perBaseUnit: Number(body.measurePerBaseUnit),
      });
      if (issue) issues.push({ path: 'packLabel', issue });
    }
    const [taken] = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.tenantId, tenantId),
          sql`lower(${items.code}) = ${lower(body.code)}`,
          ne(items.id, id),
        ),
      );
    if (taken) issues.push({ path: 'code', issue: 'Another item has this code' });
    const today = todayIn((await this.config.settings(tx, tenantId)).timezone);
    const custom = checkValueChanges(
      settings.itemFields,
      today,
      before ? before.custom : null,
      body.custom,
    );
    issues.push(
      ...custom.issues.map((issue) => ({ path: `custom.${issue.path}`, issue: issue.issue })),
    );
    if (issues.length > 0) throw invalid(issues);

    const previous = before ? await this.get(tx, tenantId, id) : null;
    const product = await this.product(tx, tenantId, by, body.productName, body.categoryName);
    const columns = {
      productId: product.id,
      code: body.code,
      name: body.name,
      packLabel: body.packLabel,
      hsn: body.hsn,
      taxRate: body.taxRate,
      mrp: body.mrp,
      baseUnit: body.baseUnit,
      measureType: body.measureType,
      measurePerBaseUnit: body.measurePerBaseUnit,
      custom: custom.values,
      active: body.active,
    };
    if (before) {
      await tx
        .update(items)
        .set({ ...columns, updatedAt: new Date(), updatedBy: by })
        .where(and(eq(items.tenantId, tenantId), eq(items.id, id)));
      await tx
        .delete(itemUnits)
        .where(and(eq(itemUnits.tenantId, tenantId), eq(itemUnits.itemId, id)));
    } else {
      await tx.insert(items).values({ id, tenantId, ...columns, createdBy: by, updatedBy: by });
    }
    await tx.insert(itemUnits).values([
      { tenantId, itemId: id, unitKey: body.baseUnit, factor: '1' },
      ...body.units.map((unit) => ({
        tenantId,
        itemId: id,
        unitKey: unit.key,
        factor: unit.factor,
      })),
    ]);
    await this.catalogue.touch(tx, tenantId);
    const item = await this.get(tx, tenantId, id);
    await this.audit.record(tx, tenantId, actor, {
      action: before ? 'item.updated' : 'item.created',
      target: { type: 'item', id },
      ...(previous ? { before: previous } : {}),
      after: item,
    });
    return { item, created: !before };
  }
}
