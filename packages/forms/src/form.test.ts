import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { checkForm, type FormContext, FormDefinition } from './form';

const text = (en: string) => ({ en, hi: en });
const noun = (one: string) => ({ en: { one, other: `${one}s` }, hi: { one, other: one } });

const context: FormContext = {
  accountTypes: new Map([
    ['customer', { contacts: true }],
    ['supplier', { contacts: false }],
  ]),
  roles: new Set(['field_user']),
  designations: new Set(['executive']),
};

type FormInput = z.input<typeof FormDefinition>;
type FieldInput = FormInput['fields'][number];

const purpose: FieldInput = {
  key: 'purpose',
  type: 'single_select',
  label: text('Purpose'),
  required: true,
  options: [
    { key: 'sale', label: text('Sale') },
    { key: 'service', label: text('Service') },
  ],
};

function form(overrides: Partial<FormInput> = {}) {
  return FormDefinition.parse({
    key: 'visit_report',
    name: noun('Visit report'),
    icon: 'map-pin',
    accountLink: { mode: 'required', accountTypes: ['customer'] },
    visitSession: true,
    photos: { min: 1, max: 3 },
    fields: [
      purpose,
      {
        key: 'amount',
        type: 'currency',
        label: text('Amount'),
        visibleWhen: { clauses: [{ field: 'purpose', op: 'in', value: ['sale'] }] },
      },
      { key: 'outcome', type: 'long_text', label: text('Outcome'), required: true },
    ],
    ...overrides,
  });
}

/** The issues of a form whose fields are `fields`, as `path: issue` lines. */
function fieldIssues(fields: FieldInput[], overrides: Partial<FormInput> = {}): string[] {
  return checkForm(form({ fields, ...overrides }), context).map(
    ({ path, issue }) => `${path}: ${issue}`,
  );
}

describe('a form definition', () => {
  it('passes when it is consistent', () => {
    expect(checkForm(form(), context)).toEqual([]);
  });

  it('fills in the defaults of spec 5.6', () => {
    const parsed = form();
    expect(parsed.shift).toBe('required');
    expect(parsed.review).toBe('manual');
    expect(parsed.geofence).toBe('inherit');
    expect(parsed.signature).toBe('none');
    expect(parsed.photos?.source).toBe('camera');
  });

  it('rejects malformed definitions before any check runs', () => {
    const bad = (input: object) => FormDefinition.safeParse({ ...form(), ...input }).success;
    expect(bad({ key: 'Visit Report' })).toBe(false);
    expect(bad({ name: { en: { one: 'Visit', other: 'Visits' } } })).toBe(false);
    expect(bad({ fields: [{ key: 'x', type: 'signature', label: text('X') }] })).toBe(false);
    expect(bad({ fields: [] })).toBe(false);
    expect(bad({ photos: { min: 1, max: 11 } })).toBe(false);
    expect(bad({ colour: 'red' })).toBe(false);
  });

  it('needs unique field keys, inside repeating groups too', () => {
    expect(
      fieldIssues([
        purpose,
        { key: 'purpose', type: 'short_text', label: text('Again') },
        {
          key: 'people',
          type: 'repeating_group',
          label: text('People met'),
          fields: [{ key: 'purpose', type: 'short_text', label: text('Inner') }],
        },
      ]),
    ).toEqual([
      'fields[1].key: Field `purpose` appears more than once',
      'fields[2].fields[0].key: Field `purpose` appears more than once',
    ]);
  });

  it('lets a condition refer only to earlier fields', () => {
    const later = { clauses: [{ field: 'outcome', op: 'is_not_empty' as const }] };
    const missing = { clauses: [{ field: 'nothing', op: 'is_empty' as const }] };
    const itself = { clauses: [{ field: 'note', op: 'is_empty' as const }] };
    expect(
      fieldIssues([
        purpose,
        { key: 'when', type: 'date', label: text('When'), visibleWhen: later },
        { key: 'where', type: 'short_text', label: text('Where'), visibleWhen: missing },
        { key: 'note', type: 'short_text', label: text('Note'), visibleWhen: itself },
        { key: 'outcome', type: 'long_text', label: text('Outcome') },
      ]),
    ).toEqual([
      'fields[1].visibleWhen.clauses[0].field: `outcome` must come before this field',
      'fields[2].visibleWhen.clauses[0].field: There is no field `nothing`',
      'fields[3].visibleWhen.clauses[0].field: `note` must come before this field',
    ]);
  });

  it('scopes conditions around repeating groups', () => {
    const issues = fieldIssues([
      purpose,
      {
        key: 'people',
        type: 'repeating_group',
        label: text('People met'),
        fields: [
          { key: 'person', type: 'short_text', label: text('Person') },
          {
            key: 'role',
            type: 'short_text',
            label: text('Role'),
            visibleWhen: {
              match: 'any',
              clauses: [
                { field: 'person', op: 'is_not_empty' },
                { field: 'purpose', op: 'eq', value: 'sale' },
              ],
            },
          },
        ],
      },
      {
        key: 'summary',
        type: 'long_text',
        label: text('Summary'),
        visibleWhen: { clauses: [{ field: 'person', op: 'is_not_empty' }] },
      },
    ]);
    expect(issues).toEqual([
      'fields[2].visibleWhen.clauses[0].field: `person` is inside repeating group `people`',
    ]);
  });

  it('checks that each comparison suits the field it compares', () => {
    const when = (clause: object) => ({ clauses: [clause] }) as FieldInput['visibleWhen'];
    expect(
      fieldIssues([
        purpose,
        { key: 'count', type: 'number', label: text('Count') },
        { key: 'paid', type: 'currency', label: text('Paid') },
        { key: 'ok', type: 'yes_no', label: text('OK') },
        {
          key: 'a',
          type: 'short_text',
          label: text('A'),
          visibleWhen: when({ field: 'purpose', op: 'gt', value: 'sale' }),
        },
        {
          key: 'b',
          type: 'short_text',
          label: text('B'),
          visibleWhen: when({ field: 'purpose', op: 'eq', value: 'refund' }),
        },
        {
          key: 'c',
          type: 'short_text',
          label: text('C'),
          visibleWhen: when({ field: 'purpose', op: 'in', value: 'sale' }),
        },
        {
          key: 'd',
          type: 'short_text',
          label: text('D'),
          visibleWhen: when({ field: 'count', op: 'gte', value: '3' }),
        },
        {
          key: 'e',
          type: 'short_text',
          label: text('E'),
          visibleWhen: when({ field: 'paid', op: 'gt', value: 5000 }),
        },
        {
          key: 'f',
          type: 'short_text',
          label: text('F'),
          visibleWhen: when({ field: 'ok', op: 'eq', value: 'yes' }),
        },
        {
          key: 'g',
          type: 'short_text',
          label: text('G'),
          visibleWhen: when({ field: 'ok', op: 'is_empty', value: true }),
        },
        {
          key: 'h',
          type: 'short_text',
          label: text('H'),
          visibleWhen: when({ field: 'count', op: 'lt' }),
        },
        {
          key: 'i',
          type: 'short_text',
          label: text('I'),
          visibleWhen: when({ field: 'paid', op: 'gt', value: '5000' }),
        },
      ]),
    ).toEqual([
      'fields[4].visibleWhen.clauses[0].op: A single_select field supports `eq`, `neq`, `in`, `not_in`, `is_empty`, `is_not_empty`',
      'fields[5].visibleWhen.clauses[0].value: `purpose` has no option `refund`',
      'fields[6].visibleWhen.clauses[0].value: Give a list of option keys for `in`',
      'fields[7].visibleWhen.clauses[0].value: Compare a number with a number',
      'fields[8].visibleWhen.clauses[0].value: Compare an amount with a decimal string, such as "5000"',
      'fields[9].visibleWhen.clauses[0].value: Compare a yes/no field with true or false',
      'fields[10].visibleWhen.clauses[0].value: Leave out the value for `is_empty`',
      'fields[11].visibleWhen.clauses[0].value: Give a value to compare with',
    ]);
  });

  it('compares catalogue selects and layout fields only as far as they allow', () => {
    expect(
      fieldIssues([
        { key: 'heading', type: 'section', label: text('Heading') },
        { key: 'item', type: 'single_select', label: text('Item'), optionsFrom: 'catalogue_items' },
        {
          key: 'a',
          type: 'short_text',
          label: text('A'),
          visibleWhen: { clauses: [{ field: 'item', op: 'eq', value: 'x1' }] },
        },
        {
          key: 'b',
          type: 'short_text',
          label: text('B'),
          visibleWhen: { clauses: [{ field: 'item', op: 'is_not_empty' }] },
        },
        {
          key: 'c',
          type: 'short_text',
          label: text('C'),
          visibleWhen: { clauses: [{ field: 'heading', op: 'is_empty' }] },
        },
      ]),
    ).toEqual([
      'fields[2].visibleWhen.clauses[0].op: A single_select field supports `is_empty`, `is_not_empty`',
      'fields[4].visibleWhen.clauses[0].op: `heading` is a section and holds no value to compare',
    ]);
  });

  it('needs a select to have either fixed options or a catalogue source', () => {
    expect(
      fieldIssues([
        { key: 'a', type: 'single_select', label: text('A') },
        { ...purpose, key: 'b', optionsFrom: 'catalogue_products' },
        {
          key: 'c',
          type: 'multi_select',
          label: text('C'),
          options: [
            { key: 'x', label: text('X') },
            { key: 'x', label: text('X again') },
          ],
          minSelected: 3,
        },
      ]),
    ).toEqual([
      'fields[0]: Give either options or optionsFrom',
      'fields[1]: Give either options or optionsFrom',
      'fields[2].options[1].key: Option `x` appears more than once',
      'fields[2].minSelected: This asks for more choices than exist',
    ]);
  });

  it('checks ranges and patterns', () => {
    expect(
      fieldIssues([
        { key: 'a', type: 'short_text', label: text('A'), minLength: 10, maxLength: 5 },
        { key: 'b', type: 'short_text', label: text('B'), pattern: '[0-9' },
        { key: 'c', type: 'number', label: text('C'), min: 10, max: 1 },
        { key: 'd', type: 'currency', label: text('D'), min: '100.50', max: '100.05' },
        { key: 'e', type: 'date', label: text('E'), minDaysFromToday: 0, maxDaysFromToday: -1 },
        { key: 'f', type: 'short_text', label: text('F'), pattern: '[A-Z]{2}[0-9]{4}' },
      ]),
    ).toEqual([
      'fields[0]: The minimum length is above the maximum',
      'fields[1].pattern: This is not a valid regular expression',
      'fields[2]: The minimum value is above the maximum',
      'fields[3]: The minimum amount is above the maximum',
      'fields[4]: The minimum date is above the maximum',
    ]);
  });

  it('lets a contact picker list contacts only of linked account types that hold them', () => {
    const picker: FieldInput = { key: 'met', type: 'contact_picker', label: text('Met') };
    expect(fieldIssues([picker])).toEqual([]);
    expect(fieldIssues([picker], { accountLink: { mode: 'none' }, visitSession: false })).toEqual([
      'fields[0]: A contact picker needs the form to link to an account',
    ]);
    expect(
      fieldIssues([picker], {
        accountLink: { mode: 'optional', accountTypes: ['customer', 'supplier'] },
        visitSession: false,
      }),
    ).toEqual(['fields[0]: Contacts are off for account type `supplier`']);
  });

  it('checks references to account types, roles and designations', () => {
    const issues = checkForm(
      form({
        accountLink: { mode: 'optional', accountTypes: ['customer', 'vendor', 'customer'] },
        visitSession: false,
        audience: { roles: ['auditor'], designations: ['executive', 'intern'] },
        fields: [
          { key: 'other', type: 'account_picker', label: text('Other'), accountTypes: ['partner'] },
        ],
      }),
      context,
    );
    expect(issues.map(({ path, issue }) => `${path}: ${issue}`)).toEqual([
      'accountLink.accountTypes[1]: There is no account type `vendor`',
      'accountLink.accountTypes[2]: Account type `customer` appears more than once',
      'audience.roles[0]: There is no role `auditor`',
      'audience.designations[1]: There is no designation `intern`',
      'fields[0].accountTypes[0]: There is no account type `partner`',
    ]);
  });

  it('needs a required account link for a form filled inside a visit, and sane photo counts', () => {
    const issues = checkForm(
      form({
        accountLink: { mode: 'optional', accountTypes: ['customer'] },
        photos: { min: 4, max: 2 },
      }),
      context,
    );
    expect(issues.map(({ path, issue }) => `${path}: ${issue}`)).toEqual([
      'visitSession: A form filled inside a visit needs a required account link',
      'photos: The minimum number of photos is above the maximum',
    ]);
  });
});
