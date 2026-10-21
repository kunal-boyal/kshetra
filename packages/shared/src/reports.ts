/**
 * Exports (module M18, decision D62): how long files are kept, how big they may grow, and cells
 * made safe to open in a spreadsheet. Pure functions, used by the export worker.
 */

/** Days an export's file is kept (M18). */
export const EXPORT_KEEP_DAYS = 7;

/** Rows one export may hold; narrow the filters for more. */
export const EXPORT_MAX_ROWS = 100_000;

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Text a spreadsheet won't run as a formula (OWASP's CSV injection advice): text starting with
 * `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe. Plain numbers, such as
 * a negative amount, stay as they are.
 */
export function neutraliseFormula(text: string): string {
  return FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

/** One CSV field: quoted when it holds a comma, quote or line break, with formulas made safe. */
export function csvField(value: string | number | boolean | null): string {
  if (value === null) return '';
  if (typeof value !== 'string') return String(value);
  const safe = neutraliseFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A CSV line, ended by CRLF as RFC 4180 has it. */
export function csvLine(values: readonly (string | number | boolean | null)[]): string {
  return `${values.map(csvField).join(',')}\r\n`;
}

/** The moment an export's file goes, from when it was made. */
export function exportExpiry(finishedAt: Date): Date {
  return new Date(finishedAt.getTime() + EXPORT_KEEP_DAYS * 86_400_000);
}
