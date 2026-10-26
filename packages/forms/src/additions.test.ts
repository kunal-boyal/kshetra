import { describe, expect, it } from 'vitest';
import { checkForm, type FormContext, FormDefinition, signatureRequired } from './form';
import { checkFormValues } from './values';

const text = (en: string) => ({ en, hi: en });
const noun = (one: string) => ({ en: { one, other: `${one}s` }, hi: { one, other: one } });
const ITEM = '01a10000-0000-7000-8000-0000000000b1';
const OTHER = '01a10000-0000-7000-8000-0000000000b2';
const TODAY = '2026-10-26';

const context: FormContext = {
  accountTypes: new Map([['doctor', { contacts: false }]]),
  roles: new Set(),
  designations: new Set(),
};

const call = (overrides: object = {}) =>
  FormDefinition.parse({
    key: 'doctor_call',
    name: noun('Doctor call'),
    icon: 'stethoscope',
    accountLink: { mode: 'required', accountTypes: ['doctor'] },
    visitSession: true,
    signature: 'optional',
    signatureRequiredWhen: { clauses: [{ field: 'samples', op: 'is_not_empty' }] },
    fields: [
      {
        key: 'products_detailed',
        type: 'product_lines',
        label: text('Products detailed'),
        required: true,
        quantities: false,
      },
      { key: 'samples', type: 'product_lines', label: text('Samples') },
      {
        key: 'no_order_reason',
        type: 'single_select',
        label: text('Why no order'),
        required: true,
        options: [{ key: 'stocked', label: text('Stocked up') }],
        visibleWhen: { clauses: [{ field: 'visit_ordered', op: 'eq', value: false }] },
      },
    ],
    ...overrides,
  });

describe('form engine additions (decision D97)', () => {
  it('accepts a signature required by a condition, and a visit form asking whether it took an order', () => {
    expect(checkForm(call(), context)).toEqual([]);
    expect(checkForm(call({ signature: 'required' }), context)).toEqual([
      {
        path: 'signatureRequiredWhen',
        issue: 'Only an optional signature is required by a condition',
      },
    ]);
    // Outside a visit there is no order to ask about.
    const outside = call({
      visitSession: false,
      signatureRequiredWhen: undefined,
      signature: 'none',
    });
    expect(checkForm(outside, context)).toContainEqual({
      path: 'fields[2].visibleWhen.clauses[0].field',
      issue: 'There is no field `visit_ordered`',
    });
    const taken = call({
      fields: [{ key: 'visit_ordered', type: 'yes_no', label: text('Ordered') }],
      signatureRequiredWhen: undefined,
    });
    expect(checkForm(taken, context)).toContainEqual({
      path: 'fields[0].key',
      issue: '`visit_ordered` is kept for whether the visit took an order',
    });
  });

  it('requires the signature only when its condition holds', () => {
    const form = call();
    expect(signatureRequired(form, { samples: [{ itemId: ITEM, quantity: 2 }] })).toBe(true);
    expect(signatureRequired(form, {})).toBe(false);
    expect(signatureRequired({ signature: 'required' }, {})).toBe(true);
    expect(signatureRequired({ signature: 'none' }, {})).toBe(false);
  });

  it('asks why there was no order only when none was taken, and counts lines without quantities as one', () => {
    const form = call();
    const lines = [{ itemId: ITEM }, { itemId: OTHER, quantity: 7 }];
    const unordered = checkFormValues(
      form,
      { products_detailed: lines },
      { today: TODAY, visitOrdered: false },
    );
    expect(unordered.issues).toEqual([{ path: 'no_order_reason', issue: 'Fill this in' }]);
    expect(unordered.values.products_detailed).toEqual([
      { itemId: ITEM, quantity: 1 },
      { itemId: OTHER, quantity: 1 },
    ]);
    const ordered = checkFormValues(
      form,
      { products_detailed: lines, no_order_reason: 'stocked' },
      { today: TODAY, visitOrdered: true },
    );
    expect(ordered.issues).toEqual([]);
    // A hidden field keeps no value.
    expect(ordered.values.no_order_reason).toBeUndefined();
  });
});
