import { describe, expect, it } from 'vitest';
import {
  SETTING_DEFAULTS,
  TerminologyOverrides,
  UpdateSettingsBody,
  withDefaults,
} from './tenant-config';

const accepts = (patch: object) => UpdateSettingsBody.safeParse(patch).success;

describe('tenant settings (spec 5.1)', () => {
  it('start from the defaults, and keep what a tenant changed', () => {
    expect(withDefaults({})).toEqual(SETTING_DEFAULTS);
    expect(withDefaults({ deviceBinding: false })).toEqual({
      ...SETTING_DEFAULTS,
      deviceBinding: false,
    });
  });

  it('change only what a request sends', () => {
    expect(UpdateSettingsBody.parse({ deviceBinding: false })).toEqual({ deviceBinding: false });
    expect(accepts({})).toBe(false);
    expect(accepts({ nonsense: 1 })).toBe(false);
  });

  it('take IANA time zones as written, and refuse offsets', () => {
    for (const zone of ['Asia/Kolkata', 'Europe/London', 'America/Argentina/Buenos_Aires', 'UTC']) {
      expect(accepts({ timezone: zone }), zone).toBe(true);
    }
    for (const zone of ['+05:30', 'asia/kolkata', 'Mars/Olympus', 'IST', '']) {
      expect(accepts({ timezone: zone }), zone).toBe(false);
    }
  });

  it('check currencies, countries and languages', () => {
    expect(accepts({ currency: 'USD', defaultCountry: 'NP' })).toBe(true);
    expect(accepts({ currency: 'XYZ' })).toBe(false);
    expect(accepts({ currency: 'inr' })).toBe(false);
    expect(accepts({ defaultCountry: 'ZZ' })).toBe(false);
    expect(accepts({ languages: ['en'] })).toBe(true);
    expect(accepts({ languages: ['hi'] })).toBe(false);
    expect(accepts({ languages: ['en', 'en'] })).toBe(false);
  });

  it('take a brand colour only when white text on it is readable', () => {
    expect(UpdateSettingsBody.parse({ brandColour: '#5B2B82' })).toEqual({
      brandColour: '#5b2b82',
    });
    expect(accepts({ brandColour: '#ffcc00' })).toBe(false);
    expect(accepts({ brandColour: 'purple' })).toBe(false);
    expect(accepts({ brandColour: null })).toBe(true);
  });

  it('keep numbers inside the ranges of spec 5.1', () => {
    expect(accepts({ gpsIntervalSeconds: 30, maxShiftHours: 24, syncWindowHours: 168 })).toBe(true);
    expect(accepts({ gpsIntervalSeconds: 10 })).toBe(false);
    expect(accepts({ geofenceRadiusMeters: 5001 })).toBe(false);
    expect(accepts({ financialYearStartMonth: 4.5 })).toBe(false);
  });
});

describe('terminology overrides (spec 5.2)', () => {
  it('take a noun in both languages, or a label', () => {
    const result = TerminologyOverrides.safeParse({
      'term.plan_item': {
        en: { one: 'Round', other: 'Rounds' },
        hi: { one: 'राउंड', other: 'राउंड' },
      },
      'term.punch_in': { en: 'Punch in', hi: 'पंच इन' },
    });
    expect(result.success).toBe(true);
  });

  it('refuse unknown terms and half-translated ones', () => {
    expect(TerminologyOverrides.safeParse({ 'term.unknown': { en: 'x', hi: 'y' } }).success).toBe(
      false,
    );
    expect(
      TerminologyOverrides.safeParse({ 'term.account': { en: { one: 'Party', other: 'Parties' } } })
        .success,
    ).toBe(false);
  });
});
