import { Injectable } from '@nestjs/common';
import type { CustomField } from '@kshetra/forms';
import type { CatalogueResult, CatalogueUnitView, ItemResult, MeasureType } from '@kshetra/shared';
import type { Catalogue } from '@kshetra/templates';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  catalogueSettings,
  items,
  itemUnits,
  productCategories,
  products,
} from '../../db/schema/catalogue';
import type { TenantTx } from '../../platform/database';
import type { SyncRowsPage } from '../sync/sync-entities';

export interface CatalogueSettings {
  units: CatalogueUnitView[];
  measureTypes: MeasureType[];
  itemFields: CustomField[];
  version: number;
}

/** A tenant whose template has no catalogue sells pieces, with no measures or item fields. */
const DEFAULT_SETTINGS: CatalogueSettings = {
  units: [
    {
      key: 'piece',
      name: { en: { one: 'Piece', other: 'Pieces' }, hi: { one: 'पीस', other: 'पीस' } },
      base: true,
    },
  ],
  measureTypes: [],
  itemFields: [],
  version: 0,
};

/**
 * The catalogue (spec 5.11): the tenant's units and item fields from its template, categories,
 * products and items. Phase 1 holds items without prices (decision D38). Its version moves with
 * every change, so apps holding it current pay one lookup.
 */
@Injectable()
export class CatalogueService {
  async applyTemplate(tx: TenantTx, tenantId: string, catalogue: Catalogue | undefined) {
    await tx.insert(catalogueSettings).values({
      tenantId,
      units: catalogue
        ? catalogue.units.map(({ key, name, base }) => ({ key, name, base }))
        : DEFAULT_SETTINGS.units,
      measureTypes: catalogue?.measureTypes ?? [],
      rounding: catalogue?.rounding ?? 'per_unit_first',
      itemFields: catalogue?.itemFields ?? [],
      rejectionReasons: catalogue?.rejectionReasons ?? [],
    });
  }

  async settings(tx: TenantTx, tenantId: string): Promise<CatalogueSettings> {
    const [row] = await tx
      .select({
        units: catalogueSettings.units,
        measureTypes: catalogueSettings.measureTypes,
        itemFields: catalogueSettings.itemFields,
        version: catalogueSettings.version,
      })
      .from(catalogueSettings)
      .where(eq(catalogueSettings.tenantId, tenantId));
    return row ? { ...row, measureTypes: row.measureTypes as MeasureType[] } : DEFAULT_SETTINGS;
  }

  async version(tx: TenantTx, tenantId: string): Promise<number> {
    return (await this.settings(tx, tenantId)).version;
  }

  /** Moves the version on, in the transaction that changed the catalogue. */
  async touch(tx: TenantTx, tenantId: string): Promise<void> {
    await tx
      .insert(catalogueSettings)
      .values({ tenantId, units: DEFAULT_SETTINGS.units, version: 2 })
      .onConflictDoUpdate({
        target: catalogueSettings.tenantId,
        set: { version: sql`${catalogueSettings.version} + 1` },
      });
  }

  /** Which of `ids` are active items and which are products, for what a form's values refer to. */
  async known(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<{ items: Set<string>; products: Set<string> }> {
    if (ids.length === 0) return { items: new Set(), products: new Set() };
    const foundItems = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(eq(items.tenantId, tenantId), inArray(items.id, [...ids]), eq(items.active, true)),
      );
    const foundProducts = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, [...ids])));
    return {
      items: new Set(foundItems.map((row) => row.id)),
      products: new Set(foundProducts.map((row) => row.id)),
    };
  }

  async items(tx: TenantTx, tenantId: string): Promise<ItemResult[]> {
    return (await this.itemRows(tx, tenantId)).map(({ row }) => row);
  }

  /**
   * Items with their row versions, by product and name, or a page of them in (version, ID) order
   * for the phones (spec 11.3).
   */
  async itemRows(
    tx: TenantTx,
    tenantId: string,
    page?: SyncRowsPage,
  ): Promise<{ version: number; id: string; row: ItemResult }[]> {
    const query = tx
      .select({
        version: items.rowVersion,
        id: items.id,
        code: items.code,
        name: items.name,
        productId: products.id,
        productName: products.name,
        categoryId: productCategories.id,
        categoryName: productCategories.name,
        packLabel: items.packLabel,
        hsn: items.hsn,
        taxRate: items.taxRate,
        mrp: items.mrp,
        baseUnit: items.baseUnit,
        measureType: items.measureType,
        measurePerBaseUnit: items.measurePerBaseUnit,
        custom: items.custom,
        active: items.active,
      })
      .from(items)
      .innerJoin(
        products,
        and(eq(products.tenantId, items.tenantId), eq(products.id, items.productId)),
      )
      .leftJoin(
        productCategories,
        and(
          eq(productCategories.tenantId, products.tenantId),
          eq(productCategories.id, products.categoryId),
        ),
      )
      .where(
        and(
          eq(items.tenantId, tenantId),
          page ? gte(items.rowVersion, page.since) : undefined,
          page?.after
            ? sql`(${items.rowVersion}, ${items.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      );
    const rows = page
      ? await query.orderBy(asc(items.rowVersion), asc(items.id)).limit(page.limit)
      : await query.orderBy(asc(products.name), asc(items.name));
    const ids = rows.map((row) => row.id);
    const units =
      ids.length === 0
        ? []
        : await tx
            .select({ itemId: itemUnits.itemId, key: itemUnits.unitKey, factor: itemUnits.factor })
            .from(itemUnits)
            .where(and(eq(itemUnits.tenantId, tenantId), inArray(itemUnits.itemId, ids)))
            .orderBy(asc(itemUnits.factor));
    return rows.map(({ version, productId, productName, categoryId, categoryName, ...row }) => ({
      version,
      id: row.id,
      row: {
        ...row,
        product: { id: productId, name: productName },
        category: categoryId && categoryName ? { id: categoryId, name: categoryName } : null,
        units: units
          .filter((unit) => unit.itemId === row.id)
          .map(({ key, factor }) => ({ key, factor })),
      },
    }));
  }

  async catalogue(tx: TenantTx, tenantId: string): Promise<CatalogueResult> {
    const settings = await this.settings(tx, tenantId);
    return {
      version: settings.version,
      units: settings.units,
      measureTypes: settings.measureTypes,
      items: await this.items(tx, tenantId),
    };
  }
}
