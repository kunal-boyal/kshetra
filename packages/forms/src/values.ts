import { type ErrorDetail, issueAt, Money, toMinorUnits } from '@kshetra/shared';
import type { Clause, Condition } from './conditions';
import type { CustomField } from './fields';

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

/**
 * Text within its lengths. A short text's `pattern` isn't applied yet: a pattern a tenant writes
 * can take the server minutes on a crafted value, so patterns wait for a matcher that runs in
 * linear time, and the places that accept fields refuse them until then (decision D41).
 */
function text(field: { minLength?: number | undefined; maxLength: number }, raw: unknown): Checked {
  if (typeof raw !== 'string') return { issue: 'Enter text' };
  const value = raw.trim();
  if (field.minLength !== undefined && value.length < field.minLength) {
    return { issue: `Enter at least ${field.minLength} characters` };
  }
  if (value.length > field.maxLength)
    return { issue: `Enter at most ${field.maxLength} characters` };
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
