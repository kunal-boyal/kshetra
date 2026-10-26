import { describe, expect, it } from 'vitest';
import { maskEmail, maskPhone, normalisePhone } from './phone';

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
