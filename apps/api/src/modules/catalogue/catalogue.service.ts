import { Injectable } from '@nestjs/common';
import type { CustomField } from '@thelamp/forms';
import {
  AppError,
  type CatalogueResult,
  type CatalogueUnitView,
  type ErrorDetail,
  issueAt,
  type ItemResult,
  type MeasureType,
  type PriceRounding,
  type RejectionReason,
} from '@thelamp/shared';
import type { Catalogue } from '@thelamp/templates';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  catalogueSettings,
  items,
  itemUnits,
  productCategories,
  products,
} from '../../db/schema/catalogue';
import { canonicalJson } from '../../platform/canonical-json';
import type { TenantTx } from '../../platform/database';
import type { SyncRowsPage } from '../sync/sync-entities';

export interface CatalogueSettings {
  units: CatalogueUnitView[];
  measureTypes: MeasureType[];
  itemFields: CustomField[];
  rounding: PriceRounding;
  rejectionReasons: RejectionReason[];
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
  rounding: 'per_unit_first',
  rejectionReasons: [],
  version: 0,
};

/**
 * The catalogue (spec 5.11): the tenant's units and item fields from its template, categories,
 * products and items; prices live in price lists (decision D77). Its version moves with every
 * change to items or prices, so apps holding it current pay one lookup.
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
        rounding: catalogueSettings.rounding,
        rejectionReasons: catalogueSettings.rejectionReasons,
        version: catalogueSettings.version,
      })
      .from(catalogueSettings)
      .where(eq(catalogueSettings.tenantId, tenantId));
    return row
      ? {
          ...row,
          measureTypes: row.measureTypes as MeasureType[],
          rounding: row.rounding as PriceRounding,
          rejectionReasons: row.rejectionReasons as RejectionReason[],
        }
      : DEFAULT_SETTINGS;
  }

  /** The settings as a template's `catalogue` holds them (M2, decision D66). */
  async section(tx: TenantTx, tenantId: string): Promise<Catalogue | undefined> {
    const [row] = await tx
      .select()
      .from(catalogueSettings)
      .where(eq(catalogueSettings.tenantId, tenantId));
    if (!row) return undefined;
    return {
      units: row.units.map(({ key, name, base }) => ({ key, name, base })),
      measureTypes: row.measureTypes as MeasureType[],
      rounding: row.rounding as Catalogue['rounding'],
      itemFields: row.itemFields,
      rejectionReasons: row.rejectionReasons as Catalogue['rejectionReasons'],
    };
  }

  /**
   * Adds and updates settings from a configuration file (M2, decision D66), removing none: units,
   * item fields and rejection reasons by key, and the measures together. The base unit stays, as
   * items' factors refer to it, and an item field keeps its type. Says whether anything changed.
   */
  async importSection(
    tx: TenantTx,
    tenantId: string,
    catalogue: Catalogue,
  ): Promise<'same' | 'update'> {
    const current = (await this.section(tx, tenantId)) ?? {
      ...DEFAULT_SETTINGS,
      rounding: 'per_unit_first' as const,
      rejectionReasons: [],
    };
    const issues: ErrorDetail[] = [];
    const base = current.units.find((unit) => unit.base)?.key;
    catalogue.units.forEach((unit, index) => {
      if (unit.base && unit.key !== base) {
        issues.push(
          issueAt(
            ['catalogue', 'units', index, 'base'],
            `The base unit stays \`${base}\`, as items' units refer to it`,
          ),
        );
      }
    });
    const types = new Map(current.itemFields.map((field) => [field.key, field.type]));
    catalogue.itemFields.forEach((field, index) => {
      const type = types.get(field.key);
      if (type && type !== field.type) {
        issues.push(
          issueAt(
            ['catalogue', 'itemFields', index, 'type'],
            `\`${field.key}\` was a ${type} field, and a key keeps its type`,
          ),
        );
      }
    });
    if (issues.length > 0)
      throw new AppError('VALIDATION', 'Check the highlighted fields.', issues);
    const merged = <T extends { key: string }>(mine: readonly T[], theirs: readonly T[]) => [
      ...mine.map((entry) => theirs.find((other) => other.key === entry.key) ?? entry),
      ...theirs.filter((other) => !mine.some((entry) => entry.key === other.key)),
    ];
    const next = {
      units: merged(current.units, catalogue.units).map((unit) => ({
        ...unit,
        base: unit.key === base,
      })),
      measureTypes: [...new Set([...current.measureTypes, ...catalogue.measureTypes])],
      rounding: catalogue.rounding,
      itemFields: merged(current.itemFields, catalogue.itemFields),
      rejectionReasons: merged(current.rejectionReasons, catalogue.rejectionReasons),
    };
    if (canonicalJson(next) === canonicalJson(current)) return 'same';
    await tx
      .insert(catalogueSettings)
      .values({ tenantId, ...next })
      .onConflictDoUpdate({ target: catalogueSettings.tenantId, set: next });
    await this.touch(tx, tenantId);
    return 'update';
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

  /** Every item, or only those with `ids`. */
  async items(tx: TenantTx, tenantId: string, ids?: readonly string[]): Promise<ItemResult[]> {
    if (ids && ids.length === 0) return [];
    return (await this.itemRows(tx, tenantId, undefined, ids)).map(({ row }) => row);
  }

  /**
   * Items with their row versions, by product and name, or a page of them in (version, ID) order
   * for the phones (spec 11.3).
   */
  async itemRows(
    tx: TenantTx,
    tenantId: string,
    page?: SyncRowsPage,
    ids?: readonly string[],
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
          ids ? inArray(items.id, [...ids]) : undefined,
          page ? gte(items.rowVersion, page.since) : undefined,
          page?.after
            ? sql`(${items.rowVersion}, ${items.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      );
    const rows = page
      ? await query.orderBy(asc(items.rowVersion), asc(items.id)).limit(page.limit)
      : await query.orderBy(asc(products.name), asc(items.name));
    const found = rows.map((row) => row.id);
    const units =
      found.length === 0
        ? []
        : await tx
            .select({ itemId: itemUnits.itemId, key: itemUnits.unitKey, factor: itemUnits.factor })
            .from(itemUnits)
            .where(and(eq(itemUnits.tenantId, tenantId), inArray(itemUnits.itemId, found)))
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
