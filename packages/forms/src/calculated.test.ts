import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { checkForm, type FormContext, FormDefinition } from './form';
import { checkFormValues, withCalculated } from './values';

/** Calculated fields in a form (decision D118). */

const text = (en: string) => ({ en, hi: en });
const noun = (one: string) => ({ en: { one, other: `${one}s` }, hi: { one, other: one } });
const context: FormContext = {
  accountTypes: new Map([['customer', { contacts: true }]]),
  roles: new Set(['field_user']),
  designations: new Set(['executive']),
};
type FieldInput = z.input<typeof FormDefinition>['fields'][number];

const form = (fields: FieldInput[]) =>
  FormDefinition.parse({
    key: 'crop_report',
    name: noun('Crop report'),
    icon: 'leaf',
    accountLink: { mode: 'none' },
    fields,
  });
const acres: FieldInput = { key: 'acres', type: 'number', label: text('Acres'), decimals: 2 };
const rate: FieldInput = { key: 'rate', type: 'currency', label: text('Rate per acre') };
const calculated = (key: string, formula: string, more: object = {}): FieldInput => ({
  key,
  type: 'calculated',
  label: text(key),
  formula,
  ...more,
});

describe('a calculated field’s formula (decision D118)', () => {
  it('reads only earlier figures, and says where it goes wrong', () => {
    const issues = checkForm(
      form([
        acres,
        { key: 'farmer', type: 'short_text', label: text('Farmer') },
        calculated('a', 'acres * later'),
        calculated('b', 'farmer + 1'),
        calculated('c', 'c + 1'),
        calculated('d', 'acres * nowhere'),
        calculated('e', 'acres *'),
        calculated('f', 'acres', { result: 'currency', decimals: 0 }),
        { key: 'later', type: 'number', label: text('Later') },
      ]),
      context,
    );
    expect(issues).toEqual([
      { path: 'fields[2].formula', issue: '`later` must come before this field' },
      {
        path: 'fields[3].formula',
        issue:
          '`farmer` is a short_text field; use number, currency, quantity or calculated fields',
      },
      { path: 'fields[4].formula', issue: 'A formula can’t use its own field' },
      { path: 'fields[5].formula', issue: 'There is no field `nowhere`' },
      { path: 'fields[6].formula', issue: 'The formula ends too soon, at character 8' },
      { path: 'fields[7].decimals', issue: 'An amount keeps 2 places' },
    ]);
  });

  it('may be compared in a later field’s condition, as what it holds', () => {
    const issues = checkForm(
      form([
        acres,
        rate,
        calculated('total', 'acres * rate', { result: 'currency' }),
        {
          key: 'reason',
          type: 'short_text',
          label: text('Reason'),
          visibleWhen: { clauses: [{ field: 'total', op: 'gt', value: 50 }] },
        },
      ]),
      context,
    );
    expect(issues).toEqual([
      {
        path: 'fields[3].visibleWhen.clauses[0].value',
        issue: 'Compare an amount with a decimal string, such as "5000"',
      },
    ]);
  });
});

describe('calculated values (decision D118)', () => {
  const crop = form([
    acres,
    rate,
    { key: 'bags', type: 'product_lines', label: text('Bags') },
    calculated('total', 'acres * rate', { result: 'currency' }),
    calculated('per_bag', 'total / bags', { decimals: 1 }),
    calculated('bonus', 'if(total > 1000, 100, 0) + default(acres, 0)', {
      result: 'currency',
      visibleWhen: { clauses: [{ field: 'acres', op: 'gte', value: 1 }] },
    }),
    {
      key: 'reason',
      type: 'short_text',
      label: text('Reason'),
      visibleWhen: { clauses: [{ field: 'total', op: 'gt', value: '1000' }] },
    },
  ]);
  const check = (input: Record<string, unknown>) =>
    checkFormValues(crop, input, { today: '2026-10-31' });

  it('works each out from the values before it, taking nothing sent for it', () => {
    const { values, issues } = check({
      acres: 2.5,
      rate: '412.30',
      bags: [{ itemId: '01a10000-0000-7000-8000-0000000000b1', quantity: 4 }],
      total: '999999.00',
      reason: 'A good year',
    });
    expect(issues).toEqual([]);
    expect(values).toEqual({
      acres: 2.5,
      rate: '412.30',
      bags: [{ itemId: '01a10000-0000-7000-8000-0000000000b1', quantity: 4 }],
      total: '1030.75',
      per_bag: 257.7,
      bonus: '102.50',
      reason: 'A good year',
    });
  });

  it('leaves a calculated field blank while what it reads is empty, and hidden ones too', () => {
    const { values } = check({ acres: 0.5, reason: 'Hidden, so dropped' });
    // No rate: no total, so nothing reads from it, and the reason stays hidden.
    expect(values).toEqual({ acres: 0.5 });
  });

  it('works out what the apps show while the form is filled, as the server will', () => {
    const shown = withCalculated(crop.fields, {
      acres: 2.5,
      rate: '412.30',
      bags: [{ itemId: '01a10000-0000-7000-8000-0000000000b1', quantity: 4 }],
      total: 'typed by hand',
    });
    expect(shown).toMatchObject({ total: '1030.75', per_bag: 257.7, bonus: '102.50' });
  });
});
