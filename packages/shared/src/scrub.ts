/**
 * What error reports may carry (spec 13, decision D98): never a phone number, an email address, a
 * one-time code, a password, a token or a signed URL's signature. Every app runs what it sends to
 * Sentry through `scrub()` first, so a value caught in a message, a URL or a field is removed.
 */

/** Fields whose values are removed whatever they hold. */
const SECRET_KEYS =
  /pass(word)?|secret|token|authori[sz]ation|cookie|otp|^code$|pin|phone|mobile|email|signature|key$/i;

const PATTERNS: [RegExp, string][] = [
  // A JWT, such as an access token.
  [/eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, '[token]'],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 [token]'],
  // A signed URL's signature and anything else secret in a query string.
  [
    /([?&](?:X-Amz-[\w-]+|Signature|Policy|Key-Pair-Id|token|code|otp|secret|password)=)[^&\s"'#]*/gi,
    '$1[removed]',
  ],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]'],
  // A one-time code or PIN named as one.
  [/\b(otp|code|pin)(\W{1,3})\d{4,8}\b/gi, '$1$2[code]'],
  // A phone number: 10 to 15 digits, at most one space or dash between any two, and maybe a +.
  [/(?<![\w+])\+?(?:\d[\s-]?){9,14}\d(?!\w)/g, '[number]'],
];

/** A text with every secret it holds replaced. */
export function scrubText(text: string): string {
  return PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

/**
 * A copy of a value with secrets removed: secret fields emptied, and every text scrubbed. Deeply
 * nested values past `depth` are dropped.
 */
export function scrub<T>(value: T, depth = 8): T {
  return scrubAny(value, depth) as T;
}

function scrubAny(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth <= 0) return '[removed]';
  if (Array.isArray(value)) return value.map((item) => scrubAny(item, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] =
      SECRET_KEYS.test(key) && item !== null && item !== undefined
        ? '[removed]'
        : scrubAny(item, depth - 1);
  }
  return out;
}
