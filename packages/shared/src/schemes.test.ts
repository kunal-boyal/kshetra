import { describe, expect, it } from 'vitest';
import {
  afterScheme,
  chooseSchemes,
  type SchemeRef,
  schemeApplies,
  schemeBenefit,
  schemeCart,
  schemeRuleIssues,
} from './schemes';

const ACCOUNT = { type: 'distributor', territories: ['t3', 't2', 't1'] };
const DATE = '2026-11-15';

function scheme(key: string, patch: Partial<SchemeRef>): SchemeRef {
  return {
    id: key,
    key,
    kind: 'percentage',
    rule: {},
    itemIds: [],
    categoryIds: [],
    accountTypeKeys: [],
    territoryIds: [],
    validFrom: '2026-11-01',
    validTo: null,
    active: true,
    ...patch,
  };
}

const line = (
  itemId: string,
  baseUnits: string,
  taxable: string,
  categoryId: string | null = null,
) => ({
  itemId,
  categoryId,
  baseUnits,
  taxable,
});

describe('BR-55: schemes on orders', () => {
  it('FX-55: chooses the larger of a percentage and a flat scheme, and taxes what is left', () => {
    // 24 packs at 360 (400 less the list's 10%): 8,640.00 taxable.
    const neem = line('neem', '24', '8640.00');
    const percent = scheme('five_off', { rule: { percent: '5' } });
    const flat = scheme('twenty_a_pack', { kind: 'flat_per_unit', rule: { amount: '20' } });
    expect(schemeBenefit(percent, neem, '24').discount).toBe('432.00');
    expect(schemeBenefit(flat, neem, '24').discount).toBe('480.00');
    const [chosen] = chooseSchemes([percent, flat], [neem], ACCOUNT, DATE, () => null);
    expect(chosen).toMatchObject({
      scheme: { key: 'twenty_a_pack' },
      benefit: { discount: '480.00' },
    });
    expect(afterScheme(neem, '480.00', '18')).toEqual({
      taxable: '8160.00',
      tax: '1468.80',
      total: '9628.80',
    });
    // A flat amount never takes more than the line is worth.
    expect(schemeBenefit(flat, line('neem', '10', '150.00'), '10').discount).toBe('150.00');
  });

  it('FX-56: reaches a slab by the base units of every line the scheme covers', () => {
    const slabs = scheme('volume', {
      kind: 'slabs',
      categoryIds: ['pesticides'],
      rule: {
        slabs: [
          { from: '100', percent: '2' },
          { from: '250', percent: '4' },
          { from: '500', percent: '6' },
        ],
      },
    });
    const lines = [
      line('neem', '150', '15000.00', 'pesticides'),
      line('karanj', '120', '6000.00', 'pesticides'),
      line('urea', '400', '9000.00', 'fertiliser'),
    ];
    const chosen = chooseSchemes([slabs], lines, ACCOUNT, DATE, () => null);
    // 270 units of pesticides reach the 4% slab; urea is outside the scheme.
    expect(chosen.map((entry) => entry?.benefit.discount ?? null)).toEqual([
      '600.00',
      '240.00',
      null,
    ]);
    // Below the first slab, nothing.
    expect(schemeBenefit(slabs, lines[1]!, '99.999').discount).toBe('0.00');
  });

  it('FX-57: gives free goods rounded down, of another item even without a price', () => {
    const tenPlusOne = scheme('ten_plus_one', {
      kind: 'free_goods',
      rule: { buy: '10', get: '1' },
    });
    expect(schemeBenefit(tenPlusOne, line('neem', '25', '9000.00'), '25').free).toEqual({
      itemId: 'neem',
      baseUnits: '2.000',
    });
    expect(schemeBenefit(tenPlusOne, line('neem', '9', '3240.00'), '9').free).toBeNull();
    const sprayer = scheme('sprayer', {
      kind: 'free_goods',
      rule: { buy: '20', get: '1', freeItemId: 'sprayer' },
    });
    // The sprayer has no price for this account: still given, worth nothing in the choice.
    const [chosen] = chooseSchemes(
      [sprayer],
      [line('neem', '40', '14400.00')],
      ACCOUNT,
      DATE,
      () => null,
    );
    expect(chosen?.benefit.free).toEqual({ itemId: 'sprayer', baseUnits: '2.000' });
    // Worth its rate, free goods beat a smaller discount: 2 packs at 360 against 1%.
    const onePercent = scheme('one_off', { rule: { percent: '1' } });
    const [best] = chooseSchemes(
      [onePercent, tenPlusOne],
      [line('neem', '25', '9000.00')],
      ACCOUNT,
      DATE,
      () => '360.00',
    );
    expect(best?.scheme.key).toBe('ten_plus_one');
  });

  it('FX-58: reaches only its items, account types, territories and dates', () => {
    const item = { itemId: 'neem', categoryId: 'pesticides' };
    expect(schemeApplies(scheme('any', {}), item, ACCOUNT, DATE)).toBe(true);
    expect(schemeApplies(scheme('ended', { validTo: '2026-11-14' }), item, ACCOUNT, DATE)).toBe(
      false,
    );
    expect(schemeApplies(scheme('later', { validFrom: '2026-11-16' }), item, ACCOUNT, DATE)).toBe(
      false,
    );
    expect(schemeApplies(scheme('off', { active: false }), item, ACCOUNT, DATE)).toBe(false);
    expect(schemeApplies(scheme('region', { territoryIds: ['t2'] }), item, ACCOUNT, DATE)).toBe(
      true,
    );
    expect(schemeApplies(scheme('elsewhere', { territoryIds: ['t9'] }), item, ACCOUNT, DATE)).toBe(
      false,
    );
    expect(
      schemeApplies(scheme('retail', { accountTypeKeys: ['retailer'] }), item, ACCOUNT, DATE),
    ).toBe(false);
    expect(schemeApplies(scheme('by_item', { itemIds: ['urea'] }), item, ACCOUNT, DATE)).toBe(
      false,
    );
    expect(
      schemeApplies(scheme('by_category', { categoryIds: ['pesticides'] }), item, ACCOUNT, DATE),
    ).toBe(true);
  });

  it('breaks a tie by the scheme valid from earlier, then by key', () => {
    const neem = line('neem', '10', '1000.00');
    const later = scheme('a_later', { rule: { percent: '5' }, validFrom: '2026-11-10' });
    const earlier = scheme('z_earlier', { rule: { percent: '5' } });
    const [chosen] = chooseSchemes([later, earlier], [neem], ACCOUNT, DATE, () => null);
    expect(chosen?.scheme.key).toBe('z_earlier');
    const twin = scheme('b_twin', { rule: { percent: '5' } });
    const [tie] = chooseSchemes([earlier, twin], [neem], ACCOUNT, DATE, () => null);
    expect(tie?.scheme.key).toBe('b_twin');
  });

  it('checks a rule by its kind', () => {
    expect(schemeRuleIssues('percentage', { percent: '0' })).toEqual([
      { path: 'rule.percent', issue: 'Give more than 0' },
    ]);
    expect(schemeRuleIssues('percentage', { percent: '120' })).toEqual([
      { path: 'rule.percent', issue: 'Give 100 or less' },
    ]);
    expect(
      schemeRuleIssues('slabs', {
        slabs: [
          { from: '250', percent: '4' },
          { from: '100', percent: '2' },
        ],
      }).map((issue) => issue.path),
    ).toEqual(['rule.slabs.1.from', 'rule.slabs.1.percent']);
    expect(schemeRuleIssues('free_goods', { buy: '10', get: '1' })).toEqual([]);
  });
});

describe('a cart with its schemes (BR-55)', () => {
  it('prices each line after its scheme and lists the free goods to quote', () => {
    const percent = scheme('five_off', { rule: { percent: '5' }, itemIds: ['neem'] });
    const tenPlusOne = scheme('ten_plus_one', {
      kind: 'free_goods',
      itemIds: ['urea'],
      rule: { buy: '10', get: '1' },
    });
    const cart = schemeCart(
      [
        { ...line('neem', '24', '8640.00'), taxRate: '18', tax: '1555.20', total: '10195.20' },
        { ...line('urea', '36', '3248.28'), taxRate: '18', tax: '584.69', total: '3832.97' },
        { ...line('mop', '5', '500.00'), taxRate: '5', tax: '25.00', total: '525.00' },
      ],
      [percent, tenPlusOne],
      ACCOUNT,
      DATE,
      () => null,
    );
    expect(
      cart.lines.map(({ taxable, tax, total, quoted }) => ({ taxable, tax, total, quoted })),
    ).toEqual([
      {
        taxable: '8208.00',
        tax: '1477.44',
        total: '9685.44',
        quoted: { key: 'five_off', discount: '432.00' },
      },
      {
        taxable: '3248.28',
        tax: '584.69',
        total: '3832.97',
        quoted: { key: 'ten_plus_one', discount: '0.00' },
      },
      { taxable: '500.00', tax: '25.00', total: '525.00', quoted: null },
    ]);
    expect(cart.free).toEqual([{ itemId: 'urea', baseUnits: '3.000', ofItemId: 'urea' }]);
  });
});
