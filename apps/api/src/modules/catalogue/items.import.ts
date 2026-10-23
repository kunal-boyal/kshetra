import { Injectable, type OnModuleInit } from '@nestjs/common';
import { checkValueChanges } from '@thelamp/forms';
import {
  AccountCode,
  type ImportProblem,
  type MeasureType,
  Money,
  newId,
  packMeasureIssue,
  percentFromCell,
  todayIn,
} from '@thelamp/shared';
import { and, eq, sql } from 'drizzle-orm';
import { items, itemUnits, productCategories, products } from '../../db/schema/catalogue';
import type { TenantTx } from '../../platform/database';
import { cellText, cellYesNo, customValues, isEmptyCell } from '../imports/reading';
import {
  type ImportContext,
  ImportRefused,
  type ImportRow,
  type ImportTargetSource,
  ImportTargets,
  type TargetField,
} from '../imports/targets';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { CatalogueService } from './catalogue.service';

interface Planned {
  row: number;
  id: string | null;
  code: string;
  name: string;
  productName: string;
  category: string | null;
  packLabel: string | null;
  baseUnit: string;
  /** How many base units a case holds, for the catalogue's other unit. */
  caseFactor: number | null;
  measureType: MeasureType | null;
  measurePerBaseUnit: string | null;
  hsn: string | null;
  taxRate: string;
  mrp: string | null;
  active: boolean;
  custom: Record<string, unknown>;
}

const lower = (text: string) => text.trim().toLowerCase();
const decimal = (text: string) => (/^\d+(\.\d+)?$/.test(text.trim()) ? Number(text) : null);
const MEASURES: Record<string, MeasureType> = {
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  l: 'L',
  ltr: 'L',
  litre: 'L',
  liter: 'L',
};

/**
 * Item imports (spec 5.11, Appendix B.3) without prices, which join in phase 2 (decision D38):
 * code as the key, the product and category by name, made when new, the base unit, a case
 * factor, the measure checked against the pack label (BR-16), tax, MRP and item fields.
 */
@Injectable()
export class ItemsImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'items';
  readonly permission = 'catalogue.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly catalogue: CatalogueService,
    private readonly config: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(tx: TenantTx, tenantId: string): Promise<TargetField[]> {
    const { itemFields } = await this.catalogue.settings(tx, tenantId);
    return [
      { key: 'item_code', names: ['Item code', 'Code', 'SKU code'], required: true },
      { key: 'item_name', names: ['Item name', 'Name', 'SKU name'], required: true },
      { key: 'product_name', names: ['Product name', 'Product'], required: true },
      { key: 'category', names: ['Category'], required: false },
      { key: 'pack_label', names: ['Pack label', 'Pack size', 'Pack'], required: false },
      { key: 'base_unit', names: ['Base unit', 'Unit'], required: true },
      { key: 'case_factor', names: ['Case factor', 'Units per case'], required: false },
      { key: 'measure_type', names: ['Measure type', 'Measure'], required: false },
      {
        key: 'measure_per_base_unit',
        names: ['Measure per base unit', 'Measure per unit'],
        required: false,
      },
      { key: 'measure_per_case', names: ['Measure per case', 'Case size'], required: false },
      { key: 'hsn', names: ['HSN', 'HSN code'], required: false },
      { key: 'tax_rate', names: ['Tax rate', 'GST', 'GST rate'], required: true },
      { key: 'mrp', names: ['MRP'], required: false },
      { key: 'active', names: ['Active', 'Status'], required: false },
      ...itemFields.map((field) => ({
        key: `custom.${field.key}`,
        names: [field.label.en, field.label.hi, field.key],
        required: false,
        label: field.label,
      })),
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const tenantId = context.access.tenantId;
    const settings = await this.catalogue.settings(tx, tenantId);
    const today = todayIn((await this.config.settings(tx, tenantId)).timezone);
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const empty = (cell: ImportRow['cells'][string] | undefined) =>
      cell === undefined || isEmptyCell(cell, context.emptyValues);
    const existing = new Map(
      (
        await tx
          .select({ id: items.id, code: items.code, custom: items.custom })
          .from(items)
          .where(eq(items.tenantId, tenantId))
      ).map((item) => [lower(item.code), item]),
    );
    const unitOf = (text: string) =>
      settings.units.find((unit) =>
        [unit.key, unit.name.en.one, unit.name.en.other, unit.name.hi.one, unit.name.hi.other]
          .map(lower)
          .includes(lower(text)),
      );
    const caseUnit = settings.units.find((unit) => !unit.base);
    const seen = new Map<string, number[]>();
    for (const { row, cells } of rows) {
      const code = lower(cellText(cells.item_code));
      if (code) seen.set(code, [...(seen.get(code) ?? []), row]);
    }

    const planned: Planned[] = [];
    for (const { row, cells } of rows) {
      const code = cellText(cells.item_code);
      const name = cellText(cells.item_name);
      const productName = cellText(cells.product_name);
      if (!code) problem(row, 'item_code', 'Fill in the item code');
      else if (!AccountCode.safeParse(code).success) {
        problem(
          row,
          'item_code',
          'Use up to 40 letters, digits, dots, dashes, slashes or underscores',
        );
      } else if ((seen.get(lower(code))?.length ?? 0) > 1) {
        problem(
          row,
          'item_code',
          `This code appears more than once, in rows ${seen.get(lower(code))!.join(', ')}`,
        );
      }
      if (!name) problem(row, 'item_name', 'Fill in the item name');
      else if (name.length > 200) problem(row, 'item_name', 'Use at most 200 characters');
      if (!productName) problem(row, 'product_name', 'Fill in the product name');
      else if (productName.length > 200) problem(row, 'product_name', 'Use at most 200 characters');
      const category = empty(cells.category) ? null : cellText(cells.category).slice(0, 100);
      const packLabel = empty(cells.pack_label) ? null : cellText(cells.pack_label).slice(0, 60);

      const base = unitOf(cellText(cells.base_unit));
      if (empty(cells.base_unit)) problem(row, 'base_unit', 'Fill in the base unit');
      else if (!base) {
        problem(
          row,
          'base_unit',
          `There is no unit called ${cellText(cells.base_unit)}; use ${settings.units.map((unit) => unit.name.en.one).join(' or ')}`,
        );
      }

      let caseFactor: number | null = null;
      if (!empty(cells.case_factor)) {
        const factor = decimal(cellText(cells.case_factor));
        if (factor === null || !Number.isInteger(factor) || factor < 1) {
          problem(row, 'case_factor', 'Write a whole number of 1 or more');
        } else if (!caseUnit) {
          problem(row, 'case_factor', 'The catalogue has no unit besides the base');
        } else caseFactor = factor;
      }

      let measureType: MeasureType | null = null;
      let perBase: number | null = null;
      if (!empty(cells.measure_type)) {
        const type = MEASURES[lower(cellText(cells.measure_type))];
        if (!type || !settings.measureTypes.includes(type)) {
          problem(
            row,
            'measure_type',
            `Write ${settings.measureTypes.join(' or ') || 'nothing: the catalogue keeps no measures'}`,
          );
        } else measureType = type;
      }
      if (!empty(cells.measure_per_base_unit)) {
        perBase = decimal(cellText(cells.measure_per_base_unit));
        if (perBase === null || perBase <= 0)
          problem(row, 'measure_per_base_unit', 'Write a number above 0');
      } else if (!empty(cells.measure_per_case)) {
        const perCase = decimal(cellText(cells.measure_per_case));
        if (perCase === null || perCase <= 0)
          problem(row, 'measure_per_case', 'Write a number above 0');
        else if (!caseFactor) problem(row, 'measure_per_case', 'Fill in the case factor too');
        else perBase = perCase / caseFactor;
      }
      if (
        (measureType === null) !== (perBase === null) &&
        !problems.some((p) => p.row === row && p.field?.startsWith('measure'))
      ) {
        problem(
          row,
          measureType ? 'measure_per_base_unit' : 'measure_type',
          'Fill in the measure type and its amount together',
        );
      }
      if (measureType && perBase !== null) {
        const issue = packMeasureIssue(packLabel, { type: measureType, perBaseUnit: perBase });
        if (issue) problem(row, 'pack_label', issue);
      }

      const hsn = empty(cells.hsn) ? null : cellText(cells.hsn);
      if (hsn && !/^[0-9A-Za-z]{2,20}$/.test(hsn))
        problem(row, 'hsn', 'Write the HSN code, up to 20 letters and digits');

      let taxRate = '';
      // BR-17: a marked column's value of 1 or less is a fraction.
      const tax = percentFromCell(cellText(cells.tax_rate), context.fractions.includes('tax_rate'));
      if (empty(cells.tax_rate)) problem(row, 'tax_rate', 'Fill in the tax rate');
      else if (tax === null) problem(row, 'tax_rate', 'Write a percentage such as 18');
      else if (Number(tax) > 100) problem(row, 'tax_rate', 'Write a percentage from 0 to 100');
      else taxRate = tax;
      let mrp: string | null = null;
      if (!empty(cells.mrp)) {
        const amount = cellText(cells.mrp).replace(/,/g, '');
        if (!Money.safeParse(amount).success)
          problem(row, 'mrp', 'Write an amount such as 125 or 125.50');
        else mrp = amount;
      }
      let active = true;
      if (!empty(cells.active)) {
        const yes = cellYesNo(cells.active);
        if (yes === null) problem(row, 'active', 'Write yes or no');
        else active = yes;
      }
      const current = existing.get(lower(code));
      const values = customValues(settings.itemFields, cells, context.emptyValues);
      const custom = checkValueChanges(
        settings.itemFields,
        today,
        current ? current.custom : null,
        current
          ? values
          : Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null)),
      );
      for (const issue of custom.issues) problem(row, issue.path, issue.issue);

      planned.push({
        row,
        id: current?.id ?? null,
        code,
        name,
        productName,
        category,
        packLabel,
        baseUnit: base?.key ?? '',
        caseFactor,
        measureType,
        measurePerBaseUnit: perBase === null ? null : String(Number(perBase.toFixed(6))),
        hsn,
        taxRate,
        mrp,
        active,
        custom: custom.values,
      });
    }
    return { problems, planned, caseUnit: caseUnit?.key ?? null };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    return (await this.plan(tx, rows, context)).problems;
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned, caseUnit } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const tenantId = context.access.tenantId;
    const by = context.access.userId;
    const categories = new Map<string, string>();
    const productIds = new Map<string, string>();
    const categoryId = async (name: string) => {
      const known = categories.get(lower(name));
      if (known) return known;
      const [found] = await tx
        .select({ id: productCategories.id })
        .from(productCategories)
        .where(
          and(
            eq(productCategories.tenantId, tenantId),
            sql`lower(${productCategories.name}) = ${lower(name)}`,
          ),
        );
      const id = found?.id ?? newId();
      if (!found) await tx.insert(productCategories).values({ id, tenantId, name });
      categories.set(lower(name), id);
      return id;
    };
    // A product moved to another category restamps its items, so phones' copies follow.
    let moved = false;
    const productId = async (name: string, category: string | null) => {
      const known = productIds.get(lower(name));
      if (known) return known;
      const [found] = await tx
        .select({ id: products.id, categoryId: products.categoryId })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), sql`lower(${products.name}) = ${lower(name)}`));
      const id = found?.id ?? newId();
      const category_ = category ? await categoryId(category) : null;
      if (!found) await tx.insert(products).values({ id, tenantId, name, categoryId: category_ });
      else if (category_ && category_ !== found.categoryId) {
        await tx
          .update(products)
          .set({ categoryId: category_ })
          .where(and(eq(products.tenantId, tenantId), eq(products.id, id)));
        await tx
          .update(items)
          .set({ updatedAt: new Date(), updatedBy: by })
          .where(and(eq(items.tenantId, tenantId), eq(items.productId, id)));
        moved = true;
      }
      productIds.set(lower(name), id);
      return id;
    };

    let created = 0;
    let updated = 0;
    for (const entry of planned) {
      const columns = {
        productId: await productId(entry.productName, entry.category),
        code: entry.code,
        name: entry.name,
        packLabel: entry.packLabel,
        hsn: entry.hsn,
        taxRate: entry.taxRate,
        mrp: entry.mrp,
        baseUnit: entry.baseUnit,
        measureType: entry.measureType,
        measurePerBaseUnit: entry.measurePerBaseUnit,
        custom: entry.custom,
        active: entry.active,
      };
      const units = [
        { unitKey: entry.baseUnit, factor: '1' },
        ...(entry.caseFactor && caseUnit && caseUnit !== entry.baseUnit
          ? [{ unitKey: caseUnit, factor: String(entry.caseFactor) }]
          : []),
      ];
      let id = entry.id;
      if (!id) {
        id = newId();
        await tx.insert(items).values({ id, tenantId, ...columns, createdBy: by, updatedBy: by });
        created += 1;
      } else {
        const [before] = await tx
          .select()
          .from(items)
          .where(and(eq(items.tenantId, tenantId), eq(items.id, id)));
        const beforeUnits = await tx
          .select({ unitKey: itemUnits.unitKey, factor: itemUnits.factor })
          .from(itemUnits)
          .where(and(eq(itemUnits.tenantId, tenantId), eq(itemUnits.itemId, id)));
        const same =
          before &&
          (Object.keys(columns) as (keyof typeof columns)[]).every(
            (key) => JSON.stringify(normal(before[key])) === JSON.stringify(normal(columns[key])),
          ) &&
          JSON.stringify(units.map((unit) => [unit.unitKey, Number(unit.factor)]).sort()) ===
            JSON.stringify(beforeUnits.map((unit) => [unit.unitKey, Number(unit.factor)]).sort());
        if (same) continue;
        await tx
          .update(items)
          .set({ ...columns, updatedAt: new Date(), updatedBy: by })
          .where(and(eq(items.tenantId, tenantId), eq(items.id, id)));
        updated += 1;
      }
      await tx
        .delete(itemUnits)
        .where(and(eq(itemUnits.tenantId, tenantId), eq(itemUnits.itemId, id)));
      await tx.insert(itemUnits).values(units.map((unit) => ({ tenantId, itemId: id!, ...unit })));
    }
    if (created + updated > 0 || moved) await this.catalogue.touch(tx, tenantId);
    return { created, updated };
  }
}

/** Numbers stored as decimal strings compare by value. */
function normal(value: unknown): unknown {
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  }
  return value;
}
