import { Injectable, type OnModuleInit } from '@nestjs/common';
import { checkValueChanges } from '@thelamp/forms';
import {
  AccountCode,
  applicableLists,
  expectedPriceIssue,
  type ImportProblem,
  type MeasureType,
  Money,
  newId,
  packMeasureIssue,
  percentFromCell,
  todayIn,
} from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { items, itemUnits } from '../../db/schema/catalogue';
import type { TenantTx } from '../../platform/database';
import { cellText, cellYesNo, customValues, isEmptyCell } from '../imports/reading';
import {
  type ImportContext,
  ImportRefused,
  type ImportRow,
  type ImportTargetSource,
  ImportTargets,
  type TargetField,
  checked,
} from '../imports/targets';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { CatalogueService } from './catalogue.service';
import { ItemsService } from './items.service';
import { PriceListsService } from './price-lists.service';

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
  /** The row's price, on the list it names or the default list. */
  price: { listId: string; price: string; discount: string } | null;
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
 * Item imports (spec 5.11, Appendix B.3): code as the key, the product and category by name, made
 * when new, the base unit, a case factor, the measure checked against the pack label (BR-16),
 * tax, MRP and item fields; and, when the file has prices, the price and discount on the list it
 * names or the default list, with any expected net or final price checked (BR-17, decision D77).
 */
@Injectable()
export class ItemsImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'items';
  readonly permission = 'catalogue.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly catalogue: CatalogueService,
    private readonly config: TenantConfigService,
    private readonly itemsService: ItemsService,
    private readonly priceLists: PriceListsService,
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
      { key: 'price', names: ['Price', 'Price per unit'], required: false },
      { key: 'discount_pct', names: ['Discount %', 'Discount'], required: false },
      { key: 'expected_net_price', names: ['Expected net price', 'Net price'], required: false },
      {
        key: 'expected_final_price',
        names: ['Expected final price', 'Final price'],
        required: false,
      },
      { key: 'price_list', names: ['Price list'], required: false },
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
    const lists = await this.priceLists.refs(tx, tenantId);
    const listsByName = new Map(lists.map((list) => [lower(list.name), list]));
    // An empty Price list cell means the default list that applies today.
    const defaultList = applicableLists(
      lists.filter((list) => list.scope === 'default'),
      { id: '', type: '', segments: [], territories: [] },
      today,
    )[0];
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
      const price = this.planPrice(
        cells,
        row,
        taxRate,
        { listsByName, defaultList: defaultList?.id ?? null },
        context,
        problem,
      );
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
        price,
      });
    }
    return { problems, planned, caseUnit: caseUnit?.key ?? null };
  }

  /** A row's price, discount and list, checked against its expected prices (BR-17). */
  private planPrice(
    cells: ImportRow['cells'],
    row: number,
    taxRate: string,
    lists: { listsByName: Map<string, { id: string }>; defaultList: string | null },
    context: ImportContext,
    problem: (row: number, field: string | null, issue: string) => void,
  ): Planned['price'] {
    const empty = (key: string) =>
      cells[key] === undefined || isEmptyCell(cells[key], context.emptyValues);
    const money = (key: string) => cellText(cells[key]).replace(/[₹,\s]/g, '');
    const priced = ['discount_pct', 'expected_net_price', 'expected_final_price', 'price_list'];
    if (empty('price')) {
      const stray = priced.find((key) => !empty(key));
      if (stray) problem(row, 'price', 'Fill in the price too');
      return null;
    }
    const price = money('price');
    let ok = true;
    if (!Money.safeParse(price).success) {
      problem(row, 'price', 'Write an amount such as 125 or 125.50');
      ok = false;
    }
    let discount = '0';
    if (!empty('discount_pct')) {
      // BR-17: a marked column's value of 1 or less is a fraction.
      const read = percentFromCell(
        cellText(cells.discount_pct),
        context.fractions.includes('discount_pct'),
      );
      if (read === null || Number(read) > 100) {
        problem(row, 'discount_pct', 'Write a percentage from 0 to 100');
        ok = false;
      } else discount = read;
    }
    let listId = lists.defaultList;
    if (!empty('price_list')) {
      const named = lists.listsByName.get(lower(cellText(cells.price_list)));
      if (!named) {
        problem(row, 'price_list', `There is no price list called ${cellText(cells.price_list)}`);
        ok = false;
      } else listId = named.id;
    } else if (!listId) {
      problem(row, 'price_list', 'Add a default price list that applies today, or name a list');
      ok = false;
    }
    const expected = {
      net: empty('expected_net_price') ? null : money('expected_net_price'),
      final: empty('expected_final_price') ? null : money('expected_final_price'),
    };
    for (const [key, value] of [
      ['expected_net_price', expected.net],
      ['expected_final_price', expected.final],
    ] as const) {
      if (value !== null && !Money.safeParse(value).success) {
        problem(row, key, 'Write an amount such as 125 or 125.50');
        ok = false;
      }
    }
    if (!ok || !taxRate) return null;
    const issue = expectedPriceIssue({ price, discount, taxRate }, expected);
    if (issue) {
      problem(
        row,
        issue.field === 'net' ? 'expected_net_price' : 'expected_final_price',
        `The price and discount give ${issue.computed}, more than 0.02 away`,
      );
      return null;
    }
    return { listId: listId!, price, discount };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    return checked(
      problems,
      planned.map((entry) => ({ existing: entry.id !== null })),
    );
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned, caseUnit } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const tenantId = context.access.tenantId;
    const by = context.access.userId;
    let moved = false;
    const productIds = new Map<string, string>();
    const productId = async (name: string, category: string | null) => {
      const known = productIds.get(lower(name));
      if (known) return known;
      const product = await this.itemsService.product(tx, tenantId, by, name, category);
      moved ||= product.moved;
      productIds.set(lower(name), product.id);
      return product.id;
    };
    const prices = new Map<string, { itemId: string; price: string; discount: string }[]>();

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
      const id = entry.id ?? newId();
      if (entry.price) {
        const { listId, ...price } = entry.price;
        prices.set(listId, [...(prices.get(listId) ?? []), { itemId: id, ...price }]);
      }
      if (!entry.id) {
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
      await tx.insert(itemUnits).values(units.map((unit) => ({ tenantId, itemId: id, ...unit })));
    }
    for (const [listId, entries] of prices) {
      await this.priceLists.importPrices(tx, tenantId, context.access, listId, entries);
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
