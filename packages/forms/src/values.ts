import { type ErrorDetail, issueAt, Money, toMinorUnits } from '@kshetra/shared';
import { RE2JS } from 're2js';
import type { Clause, Condition } from './conditions';
import type { CustomField, FormField, GroupItemField } from './fields';
import type { FormDefinition } from './form';

/** What checking values needs to know about the moment of capture. */
export interface ValueContext {
  /** The capture date, `YYYY-MM-DD` on the tenant's clock, for date limits. */
  today: string;
}

export type Values = Record<string, unknown>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` that names a real day, as days since the epoch; null otherwise. */
function dayNumber(value: string): number | null {
  if (!DATE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? time / 86_400_000
    : null;
}

function empty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A number for `number` comparisons, an amount in minor units for `currency`. */
function ordered(value: unknown): number | bigint | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && Money.safeParse(value).success) return toMinorUnits(value);
  return null;
}

function holds(clause: Clause, value: unknown): boolean {
  switch (clause.op) {
    case 'is_empty':
      return empty(value);
    case 'is_not_empty':
      return !empty(value);
    case 'eq':
    case 'neq': {
      const left = ordered(value);
      const right = ordered(clause.value);
      const same =
        left !== null && right !== null && typeof left === typeof right
          ? left === right
          : value === clause.value;
      // An empty value is neither equal nor unequal to anything.
      return clause.op === 'eq' ? same : !empty(value) && !same;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = ordered(value);
      const right = ordered(clause.value);
      if (left === null || right === null || typeof left !== typeof right) return false;
      if (clause.op === 'gt') return left > right;
      if (clause.op === 'gte') return left >= right;
      if (clause.op === 'lt') return left < right;
      return left <= right;
    }
    case 'in':
      return (
        Array.isArray(clause.value) && typeof value === 'string' && clause.value.includes(value)
      );
    case 'not_in':
      return (
        Array.isArray(clause.value) && typeof value === 'string' && !clause.value.includes(value)
      );
    case 'contains':
      return Array.isArray(value) && value.includes(clause.value);
  }
}

/** Whether a condition holds for these values; a missing value is empty. */
export function conditionHolds(condition: Condition, values: Values): boolean {
  const results = condition.clauses.map((clause) => holds(clause, values[clause.field]));
  return condition.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}

type Checked = { value: unknown } | { issue: string };

const compiled = new Map<string, RE2JS | null>();

/**
 * A pattern compiled by RE2, which matches in time linear in the text, whatever the pattern, so a
 * pattern a tenant writes can't stall the server or the phone (decision D45). Null when RE2 can't
 * compile it, such as one with backreferences.
 */
export function compilePattern(pattern: string): RE2JS | null {
  if (!compiled.has(pattern)) {
    try {
      compiled.set(pattern, RE2JS.compile(pattern));
    } catch {
      compiled.set(pattern, null);
    }
  }
  return compiled.get(pattern)!;
}

/** Text within its lengths, matching its pattern, if any, as a whole. */
function text(
  field: { minLength?: number | undefined; maxLength: number; pattern?: string | undefined },
  raw: unknown,
): Checked {
  if (typeof raw !== 'string') return { issue: 'Enter text' };
  const value = raw.trim();
  if (field.minLength !== undefined && value.length < field.minLength) {
    return { issue: `Enter at least ${field.minLength} characters` };
  }
  if (value.length > field.maxLength)
    return { issue: `Enter at most ${field.maxLength} characters` };
  if (field.pattern !== undefined && !compilePattern(field.pattern)?.matcher(value).matches()) {
    return { issue: 'Enter it in the expected form' };
  }
  return { value };
}

function check(field: CustomField, raw: unknown, context: ValueContext): Checked {
  switch (field.type) {
    case 'short_text':
    case 'long_text':
      return text(field, raw);
    case 'number': {
      const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value)) return { issue: 'Enter a number' };
      if (field.min !== undefined && value < field.min)
        return { issue: `Enter ${field.min} or more` };
      if (field.max !== undefined && value > field.max)
        return { issue: `Enter ${field.max} or less` };
      if (Number(value.toFixed(field.decimals)) !== value) {
        return {
          issue:
            field.decimals === 0
              ? 'Enter a whole number'
              : `Use at most ${field.decimals} decimal places`,
        };
      }
      return { value };
    }
    case 'currency': {
      // Amounts arrive as numbers or strings and are kept as decimal strings (spec 11.1).
      const value = typeof raw === 'number' ? String(raw) : raw;
      if (typeof value !== 'string' || !Money.safeParse(value.trim()).success) {
        return { issue: 'Enter an amount such as 1250 or 1250.50' };
      }
      const amount = value.trim();
      if (field.min !== undefined && toMinorUnits(amount) < toMinorUnits(field.min)) {
        return { issue: `Enter ${field.min} or more` };
      }
      if (field.max !== undefined && toMinorUnits(amount) > toMinorUnits(field.max)) {
        return { issue: `Enter ${field.max} or less` };
      }
      return { value: amount };
    }
    case 'date': {
      const day = typeof raw === 'string' ? dayNumber(raw) : null;
      if (day === null) return { issue: 'Enter a date as YYYY-MM-DD' };
      const today = dayNumber(context.today)!;
      if (field.minDaysFromToday !== undefined && day < today + field.minDaysFromToday) {
        return { issue: 'This date is too early' };
      }
      if (field.maxDaysFromToday !== undefined && day > today + field.maxDaysFromToday) {
        return { issue: 'This date is too late' };
      }
      return { value: raw };
    }
    case 'single_select': {
      if (typeof raw !== 'string') return { issue: 'Choose one option' };
      if (field.options && !field.options.some((option) => option.key === raw)) {
        return { issue: `There is no option \`${raw}\`` };
      }
      return { value: raw };
    }
    case 'multi_select': {
      if (!Array.isArray(raw) || raw.some((key) => typeof key !== 'string')) {
        return { issue: 'Choose options from the list' };
      }
      const keys = [...new Set(raw as string[])];
      const unknown = field.options
        ? keys.filter((key) => !field.options!.some((option) => option.key === key))
        : [];
      if (unknown.length > 0) {
        return { issue: `There is no option ${unknown.map((key) => `\`${key}\``).join(', ')}` };
      }
      if (field.minSelected !== undefined && keys.length < field.minSelected) {
        return { issue: `Choose at least ${field.minSelected}` };
      }
      if (field.maxSelected !== undefined && keys.length > field.maxSelected) {
        return { issue: `Choose at most ${field.maxSelected}` };
      }
      return { value: keys };
    }
    case 'yes_no':
      return typeof raw === 'boolean' ? { value: raw } : { issue: 'Choose yes or no' };
  }
}

/**
 * Checks values against custom fields (spec 5.6), field by field in order: a field hidden by its
 * condition keeps no value, an empty field fails only when required, and anything else must suit
 * its type and limits. Returns the values as they are stored (trimmed text, decimal strings for
 * amounts, unique option keys) and every problem, at `path` plus the field's key. A key that
 * names no field is a problem too.
 */
export function checkValues(
  fields: readonly CustomField[],
  input: Values,
  context: ValueContext,
  path: readonly PropertyKey[] = [],
): { values: Values; issues: ErrorDetail[] } {
  const values: Values = {};
  const issues: ErrorDetail[] = [];
  const known = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) issues.push(issueAt([...path, key], 'There is no such field'));
  }
  for (const field of fields) {
    if (field.visibleWhen && !conditionHolds(field.visibleWhen, values)) continue;
    const raw = input[field.key];
    if (empty(raw)) {
      if (field.required) issues.push(issueAt([...path, field.key], 'Fill this in'));
      continue;
    }
    const checked = check(field, raw, context);
    if ('issue' in checked) issues.push(issueAt([...path, field.key], checked.issue));
    else values[field.key] = checked.value;
  }
  return { values, issues };
}

/**
 * New custom values, or changes to stored ones, checked against the fields in use: the values to
 * store, or the problems at `custom.<key>`. A change checks only the keys it sends, so a field made
 * required later doesn't block an unrelated edit; `null` clears a value, and stored keys whose
 * fields were retired are kept.
 */
export function checkValueChanges(
  fields: readonly CustomField[],
  today: string,
  current: Record<string, unknown> | null,
  input: Record<string, unknown>,
): { values: Record<string, unknown>; issues: ErrorDetail[] } {
  const changing = new Set(Object.keys(input));
  const merged = { ...current };
  for (const [key, value] of Object.entries(input)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  // Stored keys whose fields were retired are kept, and not offered to the check.
  const live = new Set(fields.map((field) => field.key));
  const offered = Object.fromEntries(
    Object.entries(merged).filter(([key]) => live.has(key) || changing.has(key)),
  );
  const { values, issues } = checkValues(fields, offered, { today }, ['custom']);
  const relevant = current
    ? issues.filter((issue) => changing.has(issue.path.slice('custom.'.length).split(/[.[]/)[0]!))
    : issues;
  if (relevant.length > 0 || !current) return { values, issues: relevant };
  const stored = { ...current };
  for (const key of changing) {
    if (key in values) stored[key] = values[key];
    else delete stored[key];
  }
  return { values: stored, issues: [] };
}

/**
 * What checking a form's values may look up beyond the form. Each lookup is optional: the phone
 * checks what it knows for feedback, and the server checks everything (spec 5.6).
 */
export interface FormValueContext extends ValueContext {
  /** An account's type key, or null for one the user doesn't see. */
  accountType?: (id: string) => string | null;
  /** Whether a contact belongs to the account the form is linked to. */
  contactAtAccount?: (id: string) => boolean;
  /** Whether a catalogue item exists and is active. */
  activeItem?: (id: string) => boolean;
  /** Whether a catalogue entry may be chosen in a select that offers catalogue entries. */
  catalogueEntry?: (source: 'catalogue_products' | 'catalogue_items', id: string) => boolean;
}

/** A product line: an item, how many, and the value column's figure when the field has one. */
export interface ProductLine {
  itemId: string;
  quantity: number;
  value?: string;
}

type FieldChecked = { value: unknown } | { issues: ErrorDetail[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Quantities keep three decimals (spec 10.1). */
const QUANTITY_MAX = 1_000_000_000;

function lines(
  field: Extract<FormField, { type: 'product_lines' }>,
  raw: unknown,
  context: FormValueContext,
  path: readonly PropertyKey[],
): FieldChecked {
  if (!Array.isArray(raw)) return { issues: [issueAt(path, 'Add items from the list')] };
  if (raw.length > field.maxLines) {
    return { issues: [issueAt(path, `Add at most ${field.maxLines} lines`)] };
  }
  const issues: ErrorDetail[] = [];
  const value: ProductLine[] = [];
  const seen = new Set<string>();
  raw.forEach((line: unknown, index) => {
    const at = (rest: PropertyKey, issue: string) =>
      issues.push(issueAt([...path, index, rest], issue));
    const entry = (line ?? {}) as Record<string, unknown>;
    const itemId = entry.itemId;
    if (typeof itemId !== 'string' || !UUID.test(itemId)) return at('itemId', 'Choose an item');
    if (seen.has(itemId)) return at('itemId', 'This item is listed already');
    seen.add(itemId);
    if (context.activeItem && !context.activeItem(itemId)) {
      return at('itemId', 'This item is not in the catalogue');
    }
    const quantity = typeof entry.quantity === 'string' ? Number(entry.quantity) : entry.quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) {
      return at('quantity', 'Enter a quantity of 0 or more');
    }
    if (quantity > QUANTITY_MAX || Number(quantity.toFixed(3)) !== quantity) {
      return at('quantity', 'Use at most 3 decimal places');
    }
    const kept: ProductLine = { itemId, quantity };
    if (
      field.valueColumn &&
      entry.value !== undefined &&
      entry.value !== null &&
      entry.value !== ''
    ) {
      const amount = typeof entry.value === 'number' ? String(entry.value) : entry.value;
      if (typeof amount !== 'string' || !Money.safeParse(amount.trim()).success) {
        return at('value', 'Enter an amount such as 1250 or 1250.50');
      }
      kept.value = amount.trim();
    }
    value.push(kept);
  });
  return issues.length > 0 ? { issues } : { value };
}

function checkFormField(
  field: Exclude<FormField | GroupItemField, { type: 'section' } | { type: 'info_text' }>,
  raw: unknown,
  outer: Values,
  context: FormValueContext,
  path: readonly PropertyKey[],
): FieldChecked {
  const one = (checked: Checked): FieldChecked =>
    'issue' in checked ? { issues: [issueAt(path, checked.issue)] } : checked;
  switch (field.type) {
    case 'time':
      return typeof raw === 'string' && TIME.test(raw)
        ? { value: raw }
        : one({ issue: 'Enter a time as HH:MM' });
    case 'rating':
      return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 5
        ? { value: raw }
        : one({ issue: 'Choose from 1 to 5' });
    case 'photo':
      return typeof raw === 'string' && UUID.test(raw)
        ? { value: raw }
        : one({ issue: 'Take a photo' });
    case 'barcode': {
      if (typeof raw !== 'string') return one({ issue: 'Scan a code' });
      const value = raw.trim();
      return value.length <= 200 ? { value } : one({ issue: 'This code is too long' });
    }
    case 'account_picker': {
      if (typeof raw !== 'string' || !UUID.test(raw)) return one({ issue: 'Choose from the list' });
      if (context.accountType) {
        const type = context.accountType(raw);
        if (type === null) return one({ issue: 'Choose one you can see' });
        if (!field.accountTypes.includes(type))
          return one({ issue: 'Choose one of the listed types' });
      }
      return { value: raw };
    }
    case 'contact_picker':
      if (typeof raw !== 'string' || !UUID.test(raw)) return one({ issue: 'Choose a contact' });
      if (context.contactAtAccount && !context.contactAtAccount(raw)) {
        return one({ issue: 'Choose a contact at the linked place' });
      }
      return { value: raw };
    case 'product_lines':
      return lines(field, raw, context, path);
    case 'repeating_group': {
      if (!Array.isArray(raw)) return one({ issue: 'Add items' });
      if (raw.length > field.maxItems) return one({ issue: `Add at most ${field.maxItems}` });
      const issues: ErrorDetail[] = [];
      const items = raw.map((item: unknown, index) => {
        const checked = checkFieldList(field.fields, (item ?? {}) as Values, outer, context, [
          ...path,
          index,
        ]);
        issues.push(...checked.issues);
        return checked.values;
      });
      return issues.length > 0 ? { issues } : { value: items };
    }
    case 'single_select':
    case 'multi_select':
      if (field.optionsFrom) {
        const ids = field.type === 'single_select' ? [raw] : Array.isArray(raw) ? raw : [null];
        const bad = ids.some(
          (id) =>
            typeof id !== 'string' ||
            !UUID.test(id) ||
            (context.catalogueEntry ? !context.catalogueEntry(field.optionsFrom!, id) : false),
        );
        if (bad) return one({ issue: 'Choose from the catalogue' });
      }
      return one(check(field, raw, context));
    default:
      return one(check(field, raw, context));
  }
}

function checkFieldList(
  fields: readonly (FormField | GroupItemField)[],
  input: Values,
  outer: Values,
  context: FormValueContext,
  path: readonly PropertyKey[],
): { values: Values; issues: ErrorDetail[] } {
  const values: Values = {};
  const issues: ErrorDetail[] = [];
  const known = new Set(
    fields
      .filter((field) => field.type !== 'section' && field.type !== 'info_text')
      .map((f) => f.key),
  );
  for (const key of Object.keys(input)) {
    if (!known.has(key)) issues.push(issueAt([...path, key], 'There is no such field'));
  }
  // A hidden section hides the fields under it, up to the next section.
  let sectionShown = true;
  for (const field of fields) {
    const seen = { ...outer, ...values };
    if (field.type === 'section') {
      sectionShown = !field.visibleWhen || conditionHolds(field.visibleWhen, seen);
      continue;
    }
    if (field.type === 'info_text' || !sectionShown) continue;
    if (field.visibleWhen && !conditionHolds(field.visibleWhen, seen)) continue;
    const raw = input[field.key];
    if (empty(raw)) {
      if (field.required) {
        issues.push(
          issueAt(
            [...path, field.key],
            field.type === 'repeating_group' ? 'Add at least one' : 'Fill this in',
          ),
        );
      }
      continue;
    }
    const checked = checkFormField(field, raw, seen, context, [...path, field.key]);
    if ('issues' in checked) issues.push(...checked.issues);
    else values[field.key] = checked.value;
  }
  return { values, issues };
}

/**
 * Checks a submission's values against its form version (spec 5.6), on the phone for feedback and
 * on the server for good: hidden fields and sections keep no value, required ones must be
 * filled, and each value must suit its type, limits and pattern, and what it refers to when the
 * context can look it up. Returns the values as stored, and every problem by path.
 */
export function checkFormValues(
  form: Pick<FormDefinition, 'fields'>,
  input: Values,
  context: FormValueContext,
  path: readonly PropertyKey[] = [],
): { values: Values; issues: ErrorDetail[] } {
  return checkFieldList(form.fields, input, {}, context, path);
}
