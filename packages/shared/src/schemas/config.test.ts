import { describe, expect, it } from 'vitest';
import {
  IconName,
  Key,
  LocalizedNoun,
  LocalizedText,
  Money,
  repeats,
  toMinorUnits,
} from './config';

describe('Key', () => {
  it('accepts lowercase snake case of up to 40 characters, starting with a letter', () => {
    for (const key of ['a', 'next_visit_date', 'slot_2', 'a'.repeat(40)]) {
      expect(Key.safeParse(key).success).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const key of ['', '2nd', '_a', 'Name', 'next-visit', 'a b', 'a'.repeat(41)]) {
      expect(Key.safeParse(key).success).toBe(false);
    }
  });
});

describe('LocalizedText', () => {
  it('needs English and Hindi', () => {
    expect(LocalizedText.safeParse({ en: 'Outcome', hi: 'परिणाम' }).success).toBe(true);
    expect(LocalizedText.safeParse({ en: 'Outcome' }).success).toBe(false);
  });

  it('rejects blank text, padding and unknown languages', () => {
    expect(LocalizedText.safeParse({ en: '', hi: 'परिणाम' }).success).toBe(false);
    expect(LocalizedText.safeParse({ en: ' Outcome', hi: 'परिणाम' }).success).toBe(false);
    expect(LocalizedText.safeParse({ en: 'Outcome', hi: 'परिणाम', fr: 'Résultat' }).success).toBe(
      false,
    );
  });
});

describe('LocalizedNoun', () => {
  it('needs the singular and the plural in each language', () => {
    const visit = { one: 'Visit', other: 'Visits' };
    const hindi = { one: 'विज़िट', other: 'विज़िट' };
    expect(LocalizedNoun.safeParse({ en: visit, hi: hindi }).success).toBe(true);
    expect(LocalizedNoun.safeParse({ en: { one: 'Visit' }, hi: hindi }).success).toBe(false);
  });
});

describe('IconName', () => {
  it('accepts Lucide icon names', () => {
    expect(IconName.safeParse('map-pin').success).toBe(true);
    expect(IconName.safeParse('building-2').success).toBe(true);
    expect(IconName.safeParse('MapPin').success).toBe(false);
  });
});

describe('Money', () => {
  it('accepts decimal strings with up to two decimals', () => {
    for (const amount of ['0', '0.5', '1250', '1250.50', '9999999999999999.99']) {
      expect(Money.safeParse(amount).success).toBe(true);
    }
  });

  it('rejects numbers, signs, exponents, padding and extra decimals', () => {
    for (const amount of ['', '-5', '01', '1.234', '1e3', ' 5', '5.', 1250]) {
      expect(Money.safeParse(amount).success).toBe(false);
    }
  });

  it('converts to exact minor units, beyond the safe integer range', () => {
    expect(toMinorUnits('0')).toBe(0n);
    expect(toMinorUnits('1250.5')).toBe(125050n);
    expect(toMinorUnits('1250.05')).toBe(125005n);
    expect(toMinorUnits('9999999999999999.99')).toBe(999999999999999999n);
  });
});

describe('repeats', () => {
  it('finds each value that already appeared', () => {
    expect(repeats(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual([2, 4, 5]);
    expect(repeats([])).toEqual([]);
  });
});
