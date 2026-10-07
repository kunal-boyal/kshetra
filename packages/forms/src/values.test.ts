import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CustomField } from './fields';
import { checkValues, conditionHolds } from './values';

const text = (en: string) => ({ en, hi: en });
const fields = (...input: z.input<typeof CustomField>[]) =>
  input.map((field) => CustomField.parse(field));
const today = { today: '2026-10-07' };

const crop = fields({
  key: 'crop',
  type: 'single_select',
  label: text('Crop'),
  required: true,
  options: [
    { key: 'paddy', label: text('Paddy') },
    { key: 'wheat', label: text('Wheat') },
  ],
})[0]!;

describe('checkValues', () => {
  it('keeps values in their stored form', () => {
    const { values, issues } = checkValues(
      fields(
        { key: 'hq', type: 'short_text', label: text('HQ') },
        { key: 'acres', type: 'number', label: text('Acres'), decimals: 1, min: 0 },
        { key: 'limit', type: 'currency', label: text('Credit limit') },
        { key: 'since', type: 'date', label: text('Since') },
        {
          key: 'crops',
          type: 'multi_select',
          label: text('Crops'),
          options: [
            { key: 'paddy', label: text('Paddy') },
            { key: 'wheat', label: text('Wheat') },
          ],
        },
        { key: 'owner', type: 'yes_no', label: text('Owner') },
      ),
      {
        hq: '  Karnal ',
        acres: '2.5',
        limit: 125000.5,
        since: '2020-02-29',
        crops: ['wheat', 'wheat', 'paddy'],
        owner: false,
      },
      today,
    );
    expect(issues).toEqual([]);
    expect(values).toEqual({
      hq: 'Karnal',
      acres: 2.5,
      limit: '125000.5',
      since: '2020-02-29',
      crops: ['wheat', 'paddy'],
      owner: false,
    });
  });

  it('says what is wrong with each value, at its path', () => {
    const { values, issues } = checkValues(
      fields(
        crop,
        { key: 'acres', type: 'number', label: text('Acres'), max: 100 },
        { key: 'name', type: 'short_text', label: text('Name'), minLength: 3, maxLength: 5 },
        { key: 'limit', type: 'currency', label: text('Limit'), max: '5000' },
        { key: 'due', type: 'date', label: text('Due'), minDaysFromToday: 0 },
        { key: 'owner', type: 'yes_no', label: text('Owner') },
      ),
      {
        acres: 2.25,
        name: 'Hi',
        limit: '5000.01',
        due: '2026-10-06',
        owner: 'yes',
        stray: 1,
      },
      today,
      ['custom'],
    );
    expect(values).toEqual({});
    expect(issues).toEqual([
      { path: 'custom.stray', issue: 'There is no such field' },
      { path: 'custom.crop', issue: 'Fill this in' },
      { path: 'custom.acres', issue: 'Enter a whole number' },
      { path: 'custom.name', issue: 'Enter at least 3 characters' },
      { path: 'custom.limit', issue: 'Enter 5000 or less' },
      { path: 'custom.due', issue: 'This date is too early' },
      { path: 'custom.owner', issue: 'Choose yes or no' },
    ]);
  });

  it('refuses dates that do not exist, and options that are not offered', () => {
    const { issues } = checkValues(
      fields(crop, { key: 'since', type: 'date', label: text('Since') }),
      { crop: 'maize', since: '2026-02-29' },
      today,
    );
    expect(issues.map((issue) => issue.issue)).toEqual([
      'There is no option `maize`',
      'Enter a date as YYYY-MM-DD',
    ]);
  });

  it('keeps no value for a field its condition hides, and does not require it', () => {
    const list = fields(crop, {
      key: 'variety',
      type: 'short_text',
      label: text('Variety'),
      required: true,
      visibleWhen: { clauses: [{ field: 'crop', op: 'eq', value: 'paddy' }] },
    });
    expect(checkValues(list, { crop: 'wheat', variety: 'Basmati' }, today)).toEqual({
      values: { crop: 'wheat' },
      issues: [],
    });
    expect(checkValues(list, { crop: 'paddy' }, today).issues).toEqual([
      { path: 'variety', issue: 'Fill this in' },
    ]);
  });
});

describe('conditionHolds', () => {
  it('compares amounts exactly, numbers in order, and options by key', () => {
    expect(
      conditionHolds(
        { match: 'all', clauses: [{ field: 'limit', op: 'gt', value: '500000' }] },
        {
          limit: '500000.01',
        },
      ),
    ).toBe(true);
    expect(
      conditionHolds(
        {
          match: 'any',
          clauses: [
            { field: 'acres', op: 'lte', value: 2 },
            { field: 'crops', op: 'contains', value: 'paddy' },
          ],
        },
        { acres: 5, crops: ['paddy'] },
      ),
    ).toBe(true);
    expect(
      conditionHolds({ match: 'all', clauses: [{ field: 'crop', op: 'neq', value: 'paddy' }] }, {}),
    ).toBe(false);
    expect(
      conditionHolds({ match: 'all', clauses: [{ field: 'crop', op: 'is_empty' }] }, { crop: '' }),
    ).toBe(true);
  });
});
