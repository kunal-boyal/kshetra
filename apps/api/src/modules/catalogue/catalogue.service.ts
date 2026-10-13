import { Injectable } from '@nestjs/common';
import type { CustomField } from '@kshetra/forms';
import type { CatalogueResult, CatalogueUnitView, ItemResult, MeasureType } from '@kshetra/shared';
import type { Catalogue } from '@kshetra/templates';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  catalogueSettings,
  items,
  itemUnits,
  productCategories,
  products,
} from '../../db/schema/catalogue';
import type { TenantTx } from '../../platform/database';

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

  async items(tx: TenantTx, tenantId: string): Promise<ItemResult[]> {
    const rows = await tx
      .select({
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
      .where(eq(items.tenantId, tenantId))
      .orderBy(asc(products.name), asc(items.name));
    const units = await tx
      .select({ itemId: itemUnits.itemId, key: itemUnits.unitKey, factor: itemUnits.factor })
      .from(itemUnits)
      .where(eq(itemUnits.tenantId, tenantId))
      .orderBy(asc(itemUnits.factor));
    return rows.map(({ productId, productName, categoryId, categoryName, ...row }) => ({
      ...row,
      product: { id: productId, name: productName },
      category: categoryId && categoryName ? { id: categoryId, name: categoryName } : null,
      units: units
        .filter((unit) => unit.itemId === row.id)
        .map(({ key, factor }) => ({ key, factor })),
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
