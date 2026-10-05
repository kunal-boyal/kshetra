import { describe, expect, it } from 'vitest';
import { canonicalJson, hashRequest } from './canonical-json';

describe('canonicalJson', () => {
  it('sorts object keys at every level and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: true } })).toBe(
      '{"a":{"c":true,"d":[3,1]},"b":1}',
    );
  });

  it('drops undefined fields, as JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('hashRequest', () => {
  it('gives the same hash to the same content in any key order', () => {
    expect(hashRequest({ qty: 2, item: 'KM-21' })).toBe(hashRequest({ item: 'KM-21', qty: 2 }));
  });

  it('gives different content a different hash', () => {
    expect(hashRequest({ qty: 2 })).not.toBe(hashRequest({ qty: 3 }));
    expect(hashRequest([1, 2])).not.toBe(hashRequest([2, 1]));
  });
});
