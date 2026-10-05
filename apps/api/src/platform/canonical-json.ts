import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level, so equal content always produces equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** SHA-256 of the canonical JSON: how BR-46 decides whether two requests carry the same content. */
export function hashRequest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, sortKeys(item)]);
    return Object.fromEntries(entries);
  }
  return value;
}
