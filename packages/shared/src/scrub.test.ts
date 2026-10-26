import { describe, expect, it } from 'vitest';
import { scrub, scrubText } from './scrub';

describe('scrubbing error reports (decision D98)', () => {
  it('removes numbers, addresses, tokens and signatures from text', () => {
    expect(scrubText('No user for +91 98765 43210 or 9876543210')).toBe(
      'No user for [number] or [number]',
    );
    expect(scrubText('Mail ravi.shah@sunrise.example failed')).toBe('Mail [email] failed');
    expect(scrubText('Wrong OTP 482913, code: 1234')).toBe('Wrong OTP [code], code: [code]');
    expect(scrubText('Authorization: Bearer abc.def-ghi')).toBe('Authorization: Bearer [token]');
    expect(scrubText('token eyJhbGciOi.eyJzdWIiOiJ4.c2lnbmF0dXJl here')).toBe('token [token] here');
    expect(
      scrubText('GET https://media.example/p.jpg?Expires=1&Signature=abc&Key-Pair-Id=K1&w=2'),
    ).toBe(
      'GET https://media.example/p.jpg?Expires=1&Signature=[removed]&Key-Pair-Id=[removed]&w=2',
    );
    // Amounts and dates stay.
    expect(scrubText('Order of ₹1,250.50 on 2026-10-26 refused')).toBe(
      'Order of ₹1,250.50 on 2026-10-26 refused',
    );
  });

  it('empties secret fields at any depth, and leaves the rest', () => {
    expect(
      scrub({
        message: 'Call +919876543210',
        request: {
          headers: { authorization: 'Bearer x', 'user-agent': 'Android' },
          data: { phone: '+919876543210', otp: '123456', name: 'Ravi' },
        },
        tags: [{ code: '482913' }, { tenant: 't1' }],
        count: 3,
        none: null,
      }),
    ).toEqual({
      message: 'Call [number]',
      request: {
        headers: { authorization: '[removed]', 'user-agent': 'Android' },
        data: { phone: '[removed]', otp: '[removed]', name: 'Ravi' },
      },
      tags: [{ code: '[removed]' }, { tenant: 't1' }],
      count: 3,
      none: null,
    });
  });
});
