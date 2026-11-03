import { ApiError } from '@thelamp/api-client';
import { type MessageKey, translate } from '@thelamp/i18n';
import { describe, expect, it } from 'vitest';
import { errorMessage } from './i18n';

const inEnglish = (key: MessageKey, params?: Record<string, string | number>) =>
  translate(key, { locale: 'en', ...(params ? { params } : {}) });
const inHindi = (key: MessageKey, params?: Record<string, string | number>) =>
  translate(key, { locale: 'hi', ...(params ? { params } : {}) });

describe('what went wrong, in the console', () => {
  it('gives the server’s own reason for a refusal its code can’t explain', () => {
    const conflict = new ApiError(409, 'CONFLICT', 'Suspend the tenant before terminating it.');
    expect(errorMessage(conflict, inEnglish)).toBe('Suspend the tenant before terminating it.');
    // The API speaks English, so a Hindi reader is told so first.
    expect(errorMessage(conflict, inHindi)).toBe(
      'यह नहीं हो सका। कारण (अंग्रेज़ी में): Suspend the tenant before terminating it.',
    );
    const taken = new ApiError(409, 'CONFLICT', 'A rate set has this ID.', [
      { path: 'id', issue: 'A rate set has this ID' },
    ]);
    expect(errorMessage(taken, inEnglish)).toBe('A rate set has this ID.');
  });

  it('keeps the general text where the server says nothing more', () => {
    const fields = new ApiError(400, 'VALIDATION', 'Check the highlighted fields.', [
      { path: 'slug', issue: 'Already used by another tenant' },
    ]);
    expect(errorMessage(fields, inEnglish)).toBe(inEnglish('error.VALIDATION'));
    expect(
      errorMessage(new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.'), inHindi),
    ).toBe(inHindi('error.UNAUTHENTICATED'));
    expect(errorMessage(new ApiError(500, 'INTERNAL', 'Boom'), inEnglish)).toBe(
      inEnglish('error.INTERNAL'),
    );
  });
});
