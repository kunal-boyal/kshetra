import { describe, expect, it } from 'vitest';
import { FormDefinition } from './form';
import { checkFormValues, compilePattern } from './values';

const text = (en: string) => ({ en, hi: en });
const ITEM = '01a10000-0000-7000-8000-000000000101';
const OTHER_ITEM = '01a10000-0000-7000-8000-000000000102';
const SHOP = '01a10000-0000-7000-8000-000000000201';
const PHOTO = '01a10000-0000-7000-8000-000000000301';

const FORM = FormDefinition.parse({
  key: 'shop_visit',
  name: { en: { one: 'Shop visit', other: 'Shop visits' }, hi: { one: 'दौरा', other: 'दौरे' } },
  icon: 'store',
  accountLink: { mode: 'required', accountTypes: ['retailer'] },
  fields: [
    {
      key: 'gst',
      type: 'short_text',
      label: text('GSTIN'),
      pattern: '[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}',
    },
    { key: 'arrived', type: 'time', label: text('Arrived at'), required: true },
    { key: 'mood', type: 'rating', label: text('Mood') },
    { key: 'shelf', type: 'photo', label: text('Shelf'), required: true },
    { key: 'code', type: 'barcode', label: text('Code') },
    { key: 'met_at', type: 'account_picker', label: text('Met at'), accountTypes: ['retailer'] },
    {
      key: 'stock',
      type: 'product_lines',
      label: text('Stock'),
      valueColumn: { label: text('Price') },
      maxLines: 2,
    },
    { key: 'competitors', type: 'yes_no', label: text('Competitors seen?') },
    {
      key: 'competition',
      type: 'section',
      label: text('Competition'),
      visibleWhen: { match: 'all', clauses: [{ field: 'competitors', op: 'eq', value: true }] },
    },
    { key: 'brand', type: 'short_text', label: text('Brand'), required: true },
    { key: 'notes', type: 'section', label: text('Notes') },
    {
      key: 'people',
      type: 'repeating_group',
      label: text('People met'),
      required: true,
      maxItems: 2,
      fields: [
        { key: 'name', type: 'short_text', label: text('Name'), required: true },
        { key: 'phone', type: 'short_text', label: text('Phone'), pattern: '[6-9][0-9]{9}' },
      ],
    },
  ],
});

const context = {
  today: '2026-10-13',
  accountType: (id: string) => (id === SHOP ? 'retailer' : null),
  activeItem: (id: string) => id === ITEM || id === OTHER_ITEM,
};

describe('checking a whole form (spec 5.6)', () => {
  it('takes every field type, and keeps nothing a hidden section hides', () => {
    const { values, issues } = checkFormValues(
      FORM,
      {
        gst: '29ABCDE1234F1Z5',
        arrived: '09:30',
        mood: 4,
        shelf: PHOTO,
        code: ' 8901234567890 ',
        met_at: SHOP,
        stock: [
          { itemId: ITEM, quantity: 12, value: '45.50' },
          { itemId: OTHER_ITEM, quantity: '2.5' },
        ],
        competitors: false,
        brand: 'Hidden, so dropped',
        people: [{ name: ' Meena ', phone: '9876543210' }],
      },
      context,
    );
    expect(issues).toEqual([]);
    expect(values).toEqual({
      gst: '29ABCDE1234F1Z5',
      arrived: '09:30',
      mood: 4,
      shelf: PHOTO,
      code: '8901234567890',
      met_at: SHOP,
      stock: [
        { itemId: ITEM, quantity: 12, value: '45.50' },
        { itemId: OTHER_ITEM, quantity: 2.5 },
      ],
      competitors: false,
      people: [{ name: 'Meena', phone: '9876543210' }],
    });
  });

  it('says what is wrong with each field, by path', () => {
    const { issues } = checkFormValues(
      FORM,
      {
        gst: 'not a gstin',
        arrived: '25:00',
        mood: 6,
        met_at: '01a10000-0000-7000-8000-000000000999',
        stock: [
          { itemId: ITEM, quantity: -1 },
          { itemId: ITEM, quantity: 1 },
          { itemId: '01a10000-0000-7000-8000-000000000999', quantity: 1 },
        ],
        competitors: true,
        people: [{ phone: '12345' }],
      },
      context,
      ['values'],
    );
    expect(issues).toEqual([
      { path: 'values.gst', issue: 'Enter it in the expected form' },
      { path: 'values.arrived', issue: 'Enter a time as HH:MM' },
      { path: 'values.mood', issue: 'Choose from 1 to 5' },
      { path: 'values.shelf', issue: 'Fill this in' },
      { path: 'values.met_at', issue: 'Choose one you can see' },
      { path: 'values.stock', issue: 'Add at most 2 lines' },
      { path: 'values.brand', issue: 'Fill this in' },
      { path: 'values.people[0].name', issue: 'Fill this in' },
      { path: 'values.people[0].phone', issue: 'Enter it in the expected form' },
    ]);
  });

  it('checks product lines one by one', () => {
    const { issues } = checkFormValues(
      { fields: [FORM.fields[6]!] },
      {
        stock: [
          { itemId: ITEM, quantity: -1 },
          { itemId: OTHER_ITEM, quantity: 1.0001 },
        ],
      },
      context,
    );
    expect(issues).toEqual([
      { path: 'stock[0].quantity', issue: 'Enter a quantity of 0 or more' },
      { path: 'stock[1].quantity', issue: 'Use at most 3 decimal places' },
    ]);
  });

  it('runs patterns in linear time, and refuses the ones RE2 can not', () => {
    const slow = compilePattern('(a+)+$')!;
    const started = Date.now();
    expect(slow.matcher(`${'a'.repeat(50_000)}b`).matches()).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(compilePattern('(a)\\1')).toBeNull();
    expect(compilePattern('(?=a)a')).toBeNull();
  });
});
