import { describe, expect, it } from '@jest/globals';
import { checkFormValues, type FormField } from '@kshetra/forms';
import { translate } from '@kshetra/i18n';
import { issueText } from './issues';

const t = (key: Parameters<typeof translate>[0], params?: Record<string, string | number>) =>
  translate(key, { locale: 'en', ...(params ? { params } : {}) });
const text = (en: string) => ({ en, hi: en });
const ID = '01a10000-0000-7000-8000-0000000000b0';
const OTHER = '01a10000-0000-7000-8000-0000000000b1';

/** One field of each type, with limits, so every check can fail. */
const FIELDS: FormField[] = [
  {
    key: 'a',
    type: 'short_text',
    label: text('A'),
    required: true,
    maxLength: 3,
    minLength: 2,
    pattern: '[0-9]+',
  },
  { key: 'b', type: 'short_text', label: text('B'), required: false, maxLength: 3, minLength: 2 },
  { key: 'c', type: 'short_text', label: text('C'), required: false, maxLength: 3 },
  { key: 'd', type: 'number', label: text('D'), required: false, min: 1, max: 5, decimals: 0 },
  { key: 'e', type: 'number', label: text('E'), required: false, min: 1, decimals: 0 },
  { key: 'f', type: 'number', label: text('F'), required: false, decimals: 0 },
  { key: 'g', type: 'number', label: text('G'), required: false, decimals: 1 },
  { key: 'h', type: 'currency', label: text('H'), required: false, min: '10.00' },
  { key: 'i', type: 'date', label: text('I'), required: false, minDaysFromToday: 0 },
  { key: 'j', type: 'date', label: text('J'), required: false, maxDaysFromToday: 0 },
  { key: 'k', type: 'date', label: text('K'), required: false },
  { key: 'l', type: 'time', label: text('L'), required: false },
  {
    key: 'm',
    type: 'single_select',
    label: text('M'),
    required: false,
    options: [{ key: 'x', label: text('X') }],
  },
  {
    key: 'n',
    type: 'multi_select',
    label: text('N'),
    required: false,
    options: [
      { key: 'x', label: text('X') },
      { key: 'y', label: text('Y') },
    ],
    minSelected: 2,
  },
  {
    key: 'o',
    type: 'multi_select',
    label: text('O'),
    required: false,
    options: [
      { key: 'x', label: text('X') },
      { key: 'y', label: text('Y') },
    ],
    maxSelected: 1,
  },
  { key: 'p', type: 'yes_no', label: text('P'), required: false },
  { key: 'q', type: 'rating', label: text('Q'), required: false },
  { key: 'r', type: 'photo', label: text('R'), required: false, source: 'camera' },
  { key: 's', type: 'barcode', label: text('S'), required: false },
  { key: 't', type: 'account_picker', label: text('T'), required: false, accountTypes: ['shop'] },
  { key: 'u', type: 'contact_picker', label: text('U'), required: false },
  {
    key: 'v',
    type: 'product_lines',
    label: text('V'),
    required: false,
    maxLines: 1,
    valueColumn: { label: text('Value') },
  },
  {
    key: 'w',
    type: 'product_lines',
    label: text('W'),
    required: false,
    maxLines: 9,
    valueColumn: { label: text('Value') },
  },
  {
    key: 'x',
    type: 'repeating_group',
    label: text('X'),
    required: true,
    maxItems: 1,
    fields: [{ key: 'xa', type: 'short_text', label: text('XA'), required: true, maxLength: 9 }],
  },
  {
    key: 'y',
    type: 'repeating_group',
    label: text('Y'),
    required: false,
    maxItems: 1,
    fields: [{ key: 'ya', type: 'short_text', label: text('YA'), required: true, maxLength: 9 }],
  },
  {
    key: 'z',
    type: 'single_select',
    label: text('Z'),
    required: false,
    optionsFrom: 'catalogue_items',
  },
];

describe('problems on the phone', () => {
  it("puts every problem the value checks give in the reader's words", () => {
    const passes = [
      {
        a: 'abc',
        b: 'x',
        c: 'abcd',
        d: 9,
        e: 0,
        f: 'many',
        g: 1.25,
        h: 'ten',
        i: '2026-10-01',
        j: '2026-12-01',
        k: '13/10/2026',
        l: '25:00',
        m: 'nope',
        n: ['x'],
        o: ['x', 'y'],
        p: 'maybe',
        q: 9,
        r: 'photo',
        s: 'x'.repeat(201),
        t: 'nobody',
        u: OTHER,
        v: [
          { itemId: ID, quantity: 1 },
          { itemId: OTHER, quantity: 1 },
        ],
        w: [{ itemId: 'x' }, { itemId: ID, quantity: -1 }, { itemId: OTHER, quantity: 1.0005 }],
        y: [{}, {}],
        z: 'nope',
      },
      {
        a: 'a',
        w: [
          { itemId: ID, quantity: 1 },
          { itemId: ID, quantity: 1 },
        ],
        t: ID,
        x: [{ xa: 'ok' }],
        u: ID,
        z: ID,
      },
      { a: '1', w: [{ itemId: ID, quantity: 1, value: 'ten' }], x: 'one', t: OTHER, y: 'one' },
    ];
    const seen = new Set<string>();
    for (const input of passes) {
      const { issues } = checkFormValues({ fields: FIELDS }, input, {
        today: '2026-10-13',
        accountType: (id) => (id === ID ? 'shop' : id === OTHER ? 'depot' : null),
        contactAtAccount: (id) => id === ID,
        activeItem: (id) => id === ID,
        catalogueEntry: () => false,
      });
      for (const issue of issues) seen.add(issue.issue);
    }
    const unknown = [...seen].filter((issue) => issueText(issue, t) === t('entry.issue_check'));
    expect(unknown).toEqual([]);
    expect(seen.size).toBeGreaterThan(30);
    expect(issueText('Enter at most 3 characters', t)).toBe('Enter at most 3 characters.');
    expect(issueText('Something new', t)).toBe('Check this.');
  });
});
