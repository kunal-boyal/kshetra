import { type ErrorDetail, issueAt, Key, Money } from '@thelamp/shared';
import { z } from 'zod';
import type { AnyField } from './fields';

/** Comparison operators for `show when <field> <operator> <value>` (spec 5.6). */
export const OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'is_empty',
  'is_not_empty',
] as const;

export type Operator = (typeof OPERATORS)[number];

export const Clause = z
  .strictObject({
    field: Key,
    op: z.enum(OPERATORS),
    value: z
      .union([z.string().max(200), z.number(), z.boolean(), z.array(Key).min(1).max(100)])
      .optional()
      .meta({
        description:
          'What to compare with: a number, an amount as a decimal string, text, true or false, ' +
          'an option key, or a list of option keys for `in` and `not_in`. Leave it out for ' +
          '`is_empty` and `is_not_empty`.',
      }),
  })
  .meta({ id: 'Clause' });

/**
 * A condition on field values: all of its clauses hold, or any of them. Forms use it for
 * visibility, account types for segment rules, and metrics to filter submissions.
 */
export const Condition = z
  .strictObject({
    match: z.enum(['all', 'any']).default('all'),
    clauses: z.array(Clause).min(1).max(10),
  })
  .meta({ id: 'Condition' });

export type Clause = z.output<typeof Clause>;
export type Condition = z.output<typeof Condition>;

const EMPTINESS: readonly Operator[] = ['is_empty', 'is_not_empty'];
const ORDERED: readonly Operator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', ...EMPTINESS];
const EQUALITY: readonly Operator[] = ['eq', 'neq', ...EMPTINESS];

/**
 * The operators a field supports. A select whose options come from the catalogue has no fixed
 * keys to compare with, so it supports only the emptiness checks. Layout fields hold no value.
 */
export function operatorsFor(field: AnyField): readonly Operator[] {
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'rating':
    case 'calculated':
      return ORDERED;
    case 'short_text':
    case 'yes_no':
      return EQUALITY;
    case 'single_select':
      return field.options ? ['eq', 'neq', 'in', 'not_in', ...EMPTINESS] : EMPTINESS;
    case 'multi_select':
      return field.options ? ['contains', ...EMPTINESS] : EMPTINESS;
    case 'section':
    case 'info_text':
      return [];
    default:
      return EMPTINESS;
  }
}

/** Why `value` can't be compared with `field` using `op`, if it can't. */
function valueProblem(field: AnyField, op: Operator, value: Clause['value']): string | undefined {
  if (EMPTINESS.includes(op)) {
    return value === undefined ? undefined : `Leave out the value for \`${op}\``;
  }
  if (value === undefined) return 'Give a value to compare with';
  // A calculated field compares as what it holds (decision D118).
  if (field.type === 'calculated') {
    if (field.result === 'number') {
      return typeof value === 'number' ? undefined : 'Compare a number with a number';
    }
    return typeof value === 'string' && Money.safeParse(value).success
      ? undefined
      : 'Compare an amount with a decimal string, such as "5000"';
  }
  switch (field.type) {
    case 'number':
      return typeof value === 'number' ? undefined : 'Compare a number with a number';
    case 'rating':
      return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5
        ? undefined
        : 'Compare a rating with a whole number from 1 to 5';
    case 'currency':
      return typeof value === 'string' && Money.safeParse(value).success
        ? undefined
        : 'Compare an amount with a decimal string, such as "5000"';
    case 'short_text':
      return typeof value === 'string' ? undefined : 'Compare text with text';
    case 'yes_no':
      return typeof value === 'boolean' ? undefined : 'Compare a yes/no field with true or false';
    case 'single_select':
    case 'multi_select': {
      const list = op === 'in' || op === 'not_in';
      const keys = list ? Array.isArray(value) && value : typeof value === 'string' && [value];
      if (!keys) return list ? `Give a list of option keys for \`${op}\`` : 'Give one option key';
      const known = new Set(field.options?.map((option) => option.key));
      const unknown = keys.filter((key) => !known.has(key));
      return unknown.length === 0
        ? undefined
        : `\`${field.key}\` has no option ${unknown.map((key) => `\`${key}\``).join(', ')}`;
    }
    default:
      return undefined;
  }
}

/**
 * Checks that each clause refers to a field in `scope` and compares it sensibly. `unknown`
 * explains a key that isn't in scope, such as "There is no earlier field `purpose`".
 */
export function checkCondition(
  condition: Condition,
  scope: ReadonlyMap<string, AnyField>,
  path: readonly PropertyKey[],
  unknown: (key: string) => string,
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  condition.clauses.forEach((clause, index) => {
    const at = [...path, 'clauses', index];
    const field = scope.get(clause.field);
    if (!field) {
      issues.push(issueAt([...at, 'field'], unknown(clause.field)));
      return;
    }
    const operators = operatorsFor(field);
    if (!operators.includes(clause.op)) {
      issues.push(
        issueAt(
          [...at, 'op'],
          operators.length === 0
            ? `\`${field.key}\` is a ${field.type} and holds no value to compare`
            : `A ${field.type} field supports ${operators.map((op) => `\`${op}\``).join(', ')}`,
        ),
      );
      return;
    }
    const problem = valueProblem(field, clause.op, clause.value);
    if (problem) issues.push(issueAt([...at, 'value'], problem));
  });
  return issues;
}
