import { isId } from '@kshetra/shared';
import { describe, expect, it } from 'vitest';
import { requestIdFor } from './request-id';

describe('requestIdFor', () => {
  it("keeps a caller's well-formed ID", () => {
    expect(requestIdFor('phone-42.req:7')).toBe('phone-42.req:7');
    expect(requestIdFor(['first', 'second'])).toBe('first');
  });

  it('mints a new ID when there is none, or it could forge log lines', () => {
    for (const header of [undefined, '', 'two words', 'line\nbreak', 'x'.repeat(129)]) {
      expect(isId(requestIdFor(header))).toBe(true);
    }
  });
});
