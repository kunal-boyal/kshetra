import { describe, expect, it } from 'vitest';
import { passwordWords, passwordWordsIssue } from './passwords';

describe('staff password words (decision D101)', () => {
  const words = passwordWords({
    product: ['The Lamp', 'thelamp'],
    email: 'meera.iyer@vendor.example',
    name: 'Meera Iyer',
  });

  it('takes the product’s names and the person’s, four letters or longer, once each', () => {
    expect(words).toEqual(['thelamp', 'meeraiyer', 'meera', 'iyer']);
  });

  it('refuses a password built on any of them, whatever the case or punctuation', () => {
    for (const password of ['TheLamp-2026-rocks', 'my name is MEERA!', 'meera.iyer.secret']) {
      expect(passwordWordsIssue(password, words)).toBe(
        'Leave out your name, your email and the product’s name',
      );
    }
    expect(passwordWordsIssue('quiet orange tractor river', words)).toBeNull();
  });
});
