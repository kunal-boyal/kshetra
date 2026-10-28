/**
 * How a person is drawn when there is no photo (phase U, decision D104): their initials on a
 * pastel chip whose hue comes from their ID, so they keep one colour in the portal, the console
 * and the phone.
 */
export const AVATAR_HUES = [
  'sky',
  'peach',
  'mint',
  'lilac',
  'butter',
  'rose',
  'sage',
  'sand',
] as const;

export type AvatarHue = (typeof AVATAR_HUES)[number];

/** The hue for an ID: FNV-1a over its UTF-16 units, so every app and every run agree. */
export function avatarHue(id: string): AvatarHue {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return AVATAR_HUES[hash % AVATAR_HUES.length]!;
}

/**
 * A word's first grapheme: by `Intl.Segmenter` where the engine has it, else its first character
 * with the marks that follow, such as a Devanagari vowel sign. Hermes, the phone's engine, has no
 * `Intl.Segmenter`, so it must never be required where the module loads.
 */
export function firstGrapheme(
  word: string,
  segmenter: Pick<Intl.Segmenter, 'segment'> | null = graphemes,
): string {
  if (segmenter) return segmenter.segment(word)[Symbol.iterator]().next().value?.segment ?? '';
  return /^\P{M}\p{M}*/u.exec(word)?.[0] ?? '';
}

const graphemes: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
const first = (word: string) => firstGrapheme(word);

/**
 * The first letter of the first and last words that start with a letter, a Devanagari letter kept
 * whole with its vowel sign. Latin letters are upper-cased.
 */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word));
  if (words.length === 0) return '';
  const picked = words.length === 1 ? [words[0]!] : [words[0]!, words[words.length - 1]!];
  return picked.map((word) => first(word).toLocaleUpperCase('en')).join('');
}

/** The first three places of a ranking: gold, silver and bronze in the pastel hues. */
export const RANK_HUES: Readonly<Record<1 | 2 | 3, AvatarHue>> = {
  1: 'butter',
  2: 'sand',
  3: 'sage',
};

/** A `YYYY-MM` period moved by a number of months. */
export function shiftPeriod(period: string, by: number): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
