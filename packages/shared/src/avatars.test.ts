import { describe, expect, it } from 'vitest';
import { AVATAR_HUES, avatarHue, initialsOf, RANK_HUES, shiftPeriod } from './avatars';
import { newId } from './ids';

describe('avatarHue', () => {
  it('gives one ID the same hue every time, and spreads IDs over every hue', () => {
    const id = '01a17d44-55c7-7581-ba9c-5cb74b321e59';
    expect(avatarHue(id)).toBe(avatarHue(id));
    const seen = new Set(Array.from({ length: 200 }, () => avatarHue(newId())));
    expect([...seen].sort()).toEqual([...AVATAR_HUES].sort());
  });
});

describe('initialsOf', () => {
  it('takes the first letter of the first and last words', () => {
    expect(initialsOf('Kavita Deshmukh')).toBe('KD');
    expect(initialsOf('Balasaheb Rao Ghuge')).toBe('BG');
    expect(initialsOf('sunita')).toBe('S');
    expect(initialsOf('   ')).toBe('');
  });

  it('keeps a Devanagari letter whole, with its vowel sign', () => {
    expect(initialsOf('सुनीता जोशी')).toBe('सुजो');
  });
});

describe('RANK_HUES', () => {
  it('colours the first three places only', () => {
    expect(RANK_HUES).toEqual({ 1: 'butter', 2: 'sand', 3: 'sage' });
  });
});

describe('shiftPeriod', () => {
  it('moves a month across a year boundary both ways', () => {
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-10', 0)).toBe('2026-10');
  });
});
