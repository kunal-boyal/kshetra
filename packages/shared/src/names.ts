/**
 * BR-42: matching a person's name from an import, such as a "Reports to" column, to the people who
 * exist. Nothing is guessed: a name matches only when one candidate clearly fits.
 */

/** Titles that say nothing about who someone is. */
const HONORIFICS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'prof',
  'shri',
  'sri',
  'shree',
  'smt',
  'kumari',
  'km',
  'er',
  'adv',
  'श्री',
  'श्रीमती',
  'सुश्री',
  'कुमारी',
  'डॉ',
]);

/** A fuzzy match needs at least this similarity... */
const SIMILAR_ENOUGH = 0.88;
/** ...and this much more than the next candidate. */
const CLEAR_LEAD = 0.04;

/**
 * The words of a name: lowercase, letters and digits only, without honorifics. Letters keep their
 * combining marks, which Devanagari writes its vowels with.
 */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\s.,'’-]+/u)
    .map((word) => word.replace(/[^\p{L}\p{M}\p{N}]/gu, ''))
    .filter((word) => word !== '' && !HONORIFICS.has(word));
}

/** A name as BR-42 compares it: its words run together. */
export function normaliseName(name: string): string {
  return nameWords(name).join('');
}

function levenshtein(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

/** 1 − Levenshtein distance ÷ the length of the longer normalised name. */
export function nameSimilarity(a: string, b: string): number {
  const left = normaliseName(a);
  const right = normaliseName(b);
  const longer = Math.max([...left].length, [...right].length);
  return longer === 0 ? 0 : 1 - levenshtein(left, right) / longer;
}

/** Whether `query` names `candidate` word for word, where a single letter stands for a word. */
function initialsMatch(query: readonly string[], candidate: readonly string[]): boolean {
  return (
    query.length === candidate.length &&
    query.some((word) => [...word].length === 1) &&
    query.every((word, index) => {
      const other = candidate[index]!;
      return [...word].length === 1 ? other.startsWith(word) : word === other;
    })
  );
}

export type NameMatch<T> =
  | { status: 'matched'; candidate: T; similarity: number }
  | { status: 'ambiguous'; candidates: T[] }
  | { status: 'none' };

/**
 * Finds the one candidate a name means (BR-42). An exact match wins when it is the only one;
 * then a match on initials ("A Verma" for "Asha Verma") when only one fits; then the most similar
 * name, when it is similar enough and clearly ahead of the next. Anything else is ambiguous, or no
 * match, and the row fails.
 */
export function matchName<T extends { name: string }>(
  query: string,
  candidates: readonly T[],
): NameMatch<T> {
  const target = normaliseName(query);
  if (target === '') return { status: 'none' };
  const exact = candidates.filter((candidate) => normaliseName(candidate.name) === target);
  if (exact.length === 1) return { status: 'matched', candidate: exact[0]!, similarity: 1 };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };

  const words = nameWords(query);
  const initials = candidates.filter((candidate) =>
    initialsMatch(words, nameWords(candidate.name)),
  );
  if (initials.length === 1) return { status: 'matched', candidate: initials[0]!, similarity: 1 };
  if (initials.length > 1) return { status: 'ambiguous', candidates: initials };

  const ranked = candidates
    .map((candidate) => ({ candidate, similarity: nameSimilarity(query, candidate.name) }))
    .sort((a, b) => b.similarity - a.similarity);
  const [best, next] = ranked;
  if (!best || best.similarity < SIMILAR_ENOUGH) return { status: 'none' };
  if (next && best.similarity - next.similarity < CLEAR_LEAD) {
    return {
      status: 'ambiguous',
      candidates: ranked
        .filter((entry) => best.similarity - entry.similarity < CLEAR_LEAD)
        .map((entry) => entry.candidate),
    };
  }
  return { status: 'matched', candidate: best.candidate, similarity: best.similarity };
}
