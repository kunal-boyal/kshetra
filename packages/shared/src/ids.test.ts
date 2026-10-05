import { describe, expect, it } from 'vitest';
import { isId, newId } from './ids';

describe('newId', () => {
  it('returns a UUID v7', () => {
    expect(isId(newId())).toBe(true);
  });

  it('sorts in creation order, even within one millisecond', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('isId', () => {
  it('rejects other UUID versions and malformed values', () => {
    expect(isId('0b6f2f4e-3c1a-4e8b-9a8e-2f1d5c6b7a90')).toBe(false);
    expect(isId('not-an-id')).toBe(false);
    expect(isId('')).toBe(false);
  });
});
