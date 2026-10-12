import { describe, expect, it } from 'vitest';
import { matchName, nameSimilarity, normaliseName } from './names';

const asha = { id: 'asha', name: 'Asha Verma' };
const anil = { id: 'anil', name: 'Anil Verma' };
const ravi = { id: 'ravi', name: 'Ravi Kumar' };

describe('BR-42: matching names on import', () => {
  it('normalises names: lowercase, no honorifics, letters and digits only', () => {
    expect(normaliseName('Smt. Asha VERMA')).toBe('ashaverma');
    expect(normaliseName('Dr Ravi  Kumar-2')).toBe('ravikumar2');
    expect(normaliseName('श्री राम कुमार')).toBe('रामकुमार');
  });

  it('FX-32: "A Verma" with both Asha Verma and Anil Verma is ambiguous', () => {
    expect(matchName('A Verma', [asha, anil, ravi])).toEqual({
      status: 'ambiguous',
      candidates: [asha, anil],
    });
  });

  it('FX-33: "Asha Verrma" matches Asha Verma, the only close candidate, at 0.9', () => {
    expect(nameSimilarity('Asha Verrma', 'Asha Verma')).toBeCloseTo(0.9);
    expect(matchName('Asha Verrma', [asha, ravi])).toEqual({
      status: 'matched',
      candidate: asha,
      similarity: expect.closeTo(0.9),
    });
  });

  it('matches initials when only one person fits, and an exact name first', () => {
    expect(matchName('A Verma', [asha, ravi])).toMatchObject({
      status: 'matched',
      candidate: asha,
    });
    expect(matchName('Mrs Asha Verma', [asha, anil])).toMatchObject({ candidate: asha });
  });

  it('guesses nothing: too different, or not clearly ahead, is no match or ambiguous', () => {
    expect(matchName('Asha Sharma', [asha])).toEqual({ status: 'none' });
    const sunil = { id: 'sunil', name: 'Sunil Raghavan' };
    const sunit = { id: 'sunit', name: 'Sunit Raghavan' };
    expect(matchName('Sunik Raghavan', [sunil, sunit])).toEqual({
      status: 'ambiguous',
      candidates: [sunil, sunit],
    });
    expect(matchName('  ', [asha])).toEqual({ status: 'none' });
  });
});
