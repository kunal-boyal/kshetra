import { describe, expect, it } from 'vitest';
import {
  isEmail,
  maskEmail,
  maskPhone,
  mobileDigits,
  mobileDigitsFrom,
  mobileDigitsIssue,
  normaliseMobile,
  normalisePhone,
} from './phone';

describe('normalisePhone', () => {
  it('turns Indian numbers into E.164, however they are written', () => {
    for (const raw of [
      '9876543210',
      '09876543210',
      '+91 98765 43210',
      '+91-98765-43210',
      ' 98765 43210 ',
    ]) {
      expect(normalisePhone(raw)).toBe('+919876543210');
    }
  });

  it('keeps numbers from other countries when they carry their code', () => {
    expect(normalisePhone('+44 7911 123456')).toBe('+447911123456');
  });

  it('rejects what is not a valid number', () => {
    for (const raw of ['', '12345', 'phone', '+91 12345']) {
      expect(normalisePhone(raw)).toBeNull();
    }
  });
});

describe('maskPhone', () => {
  it('hides all but the country code and the last five digits', () => {
    expect(maskPhone('+919876543210')).toBe('+91•••••43210');
  });
});

describe('maskEmail', () => {
  it('keeps the first letter and the domain only', () => {
    expect(maskEmail('meera.iyer@vendor.example')).toBe('m…@vendor.example');
    expect(maskEmail('not an address')).toBe('n…@');
  });
});

describe('people’s mobile numbers (decision D102)', () => {
  it('takes ten digits starting 6 to 9, however they are written', () => {
    expect(normaliseMobile('9876543210')).toBe('+919876543210');
    expect(normaliseMobile('+91 98765-43210')).toBe('+919876543210');
    expect(normaliseMobile('09876543210')).toBe('+919876543210');
    expect(normaliseMobile('6000000001')).toBe('+916000000001');
  });

  it('refuses landlines, short or long numbers, and letters', () => {
    expect(normaliseMobile('01123456789')).toBeNull(); // a Delhi landline
    expect(normaliseMobile('1412345678')).toBeNull();
    expect(normaliseMobile('987654321')).toBeNull();
    expect(normaliseMobile('98765432101')).toBeNull();
    expect(normaliseMobile('98765abcde')).toBeNull();
  });

  it('keeps other countries’ valid numbers for tenants set there', () => {
    expect(normaliseMobile('+14155552671', 'US')).toBe('+14155552671');
  });

  it('says what is wrong with the digits typed in a mobile field', () => {
    expect(mobileDigitsIssue('')).toBe('required');
    expect(mobileDigitsIssue('98765')).toBe('length');
    expect(mobileDigitsIssue('5876543210')).toBe('start');
    expect(mobileDigitsIssue('9876543210')).toBeNull();
  });

  it('keeps digits only, dropping a pasted +91 or 0', () => {
    expect(mobileDigitsFrom('+91 98765 43210')).toBe('9876543210');
    expect(mobileDigitsFrom('098765-43210')).toBe('9876543210');
    expect(mobileDigitsFrom('98765abc43210')).toBe('9876543210');
    expect(mobileDigitsFrom('987654321099')).toBe('9876543210');
  });

  it('shows a stored Indian number as its ten digits', () => {
    expect(mobileDigits('+919876543210')).toBe('9876543210');
    expect(mobileDigits(null)).toBe('');
  });
});

describe('email addresses (decision D102)', () => {
  it('takes a name, an @ and a domain', () => {
    expect(isEmail('meera@example.com')).toBe(true);
    expect(isEmail(' meera.iyer@sunrise.example ')).toBe(true);
  });

  it('refuses what is not one', () => {
    for (const value of ['', 'meera', 'meera@', '@example.com', 'meera@example', 'meera @x.com']) {
      expect(isEmail(value)).toBe(false);
    }
  });
});
