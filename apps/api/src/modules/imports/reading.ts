import type { CustomField } from '@thelamp/forms';
import { parse } from 'csv-parse/sync';
import { unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';

/**
 * Reading customers' files for import (module M19, Appendix B): the sheet, its header row, and
 * cells as text, dates and yes-or-no values. Pure functions, so they test without a database.
 */

/** A cell as read: XLSX numbers stay as written, so codes and phone numbers keep every digit. */
export type Cell = string | boolean | Date | null;

/** Largest file accepted (M19). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Largest a spreadsheet may unpack to, so a small file can't fill the worker's memory. */
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
/** Rows after the header, for now; plans will set their own limits (M19). */
export const MAX_ROWS = 20_000;
/** The header is somewhere in the first rows (M19). */
const HEADER_SEARCH_ROWS = 15;

export type FileKind = 'csv' | 'xlsx';

export class UnreadableFileError extends Error {}

/** What a file is, by its name and type; null for anything else. */
export function fileKind(fileName: string, contentType: string): FileKind | null {
  // The name's extension decides; a name without one falls back to the content type.
  const extension = /\.([^./\\]+)$/.exec(fileName)?.[1]?.toLowerCase();
  if (extension !== undefined) {
    return extension === 'csv' ? 'csv' : extension === 'xlsx' ? 'xlsx' : null;
  }
  if (contentType === 'text/csv') return 'csv';
  if (contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return 'xlsx';
  }
  return null;
}

/** Refuses a spreadsheet that says it unpacks to more than the limit, before unpacking it. */
function checkUnpackedSize(bytes: Uint8Array): void {
  let total = 0;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        return false;
      },
    });
  } catch {
    throw new UnreadableFileError('This is not a readable XLSX file.');
  }
  if (total > MAX_UNPACKED_BYTES) {
    throw new UnreadableFileError('This spreadsheet is too large once unpacked.');
  }
}

export interface ReadSheet {
  sheets: string[];
  sheet: string | null;
  rows: Cell[][];
}

/** The rows of a CSV file, or of one sheet of an XLSX file: the first, or the one named. */
export async function readRows(
  bytes: Uint8Array,
  kind: FileKind,
  sheet?: string | null,
): Promise<ReadSheet> {
  if (kind === 'csv') {
    try {
      const rows = parse(Buffer.from(bytes), {
        bom: true,
        relax_column_count: true,
        relax_quotes: true,
        skip_empty_lines: false,
      }) as string[][];
      return { sheets: [], sheet: null, rows };
    } catch {
      throw new UnreadableFileError('This is not a readable CSV file.');
    }
  }
  checkUnpackedSize(bytes);
  let sheets: Awaited<ReturnType<typeof readXlsxFile<string>>>;
  try {
    // Numbers stay as written, so long codes and phone numbers don't become floats.
    sheets = await readXlsxFile<string>(Buffer.from(bytes), { parseNumber: (text) => text });
  } catch {
    throw new UnreadableFileError('This is not a readable XLSX file.');
  }
  const names = sheets.map((entry) => entry.sheet);
  const chosen = sheet ? sheets.find((entry) => entry.sheet === sheet) : sheets[0];
  if (!chosen) throw new UnreadableFileError(`There is no sheet called ${sheet}.`);
  return { sheets: names, sheet: chosen.sheet, rows: chosen.data as Cell[][] };
}

/** A header as imports compare it, as template aliases are written: lowercase letters and digits. */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** The text of a cell, trimmed; Excel's trailing `.0` on whole numbers is dropped. */
export function cellText(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell === 'boolean') return cell ? 'yes' : 'no';
  const text = String(cell).trim();
  return /^-?\d+\.0+$/.test(text) ? text.replace(/\.0+$/, '') : text;
}

/** True when a cell holds nothing, or a value the target treats as nothing, such as "-". */
export function isEmptyCell(cell: Cell | undefined, emptyValues: readonly string[] = []): boolean {
  const text = cellText(cell);
  return text === '' || emptyValues.some((value) => value.toLowerCase() === text.toLowerCase());
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * A date from a cell (Appendix B): a date cell, an Excel serial number, `YYYY-MM-DD` or
 * `DD-MM-YYYY` (with `-`, `/` or `.`). Null when the cell isn't one.
 */
export function cellDate(cell: Cell | undefined): string | null {
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  const text = cellText(cell);
  let year: number;
  let month: number;
  let day: number;
  let match: RegExpMatchArray | null;
  if ((match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if (/^\d{4,5}(\.\d+)?$/.test(text)) {
    const date = new Date(EXCEL_EPOCH + Math.floor(Number(text)) * 86_400_000);
    [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Yes or no from a cell, or null when it is neither. */
export function cellYesNo(cell: Cell | undefined): boolean | null {
  if (typeof cell === 'boolean') return cell;
  const text = cellText(cell).toLowerCase();
  if (['yes', 'y', 'true', '1', 'active', 'हाँ'].includes(text)) return true;
  if (['no', 'n', 'false', '0', 'inactive', 'नहीं'].includes(text)) return false;
  return null;
}

/**
 * The custom-field values a row's `custom.<key>` columns hold, as the form engine takes them:
 * an empty cell is null, which clears a stored value; yes and no become booleans; a multi-select
 * splits at commas or semicolons; a date may be a date cell. The engine checks the rest.
 */
export function customValues(
  fields: readonly CustomField[],
  cells: Readonly<Record<string, Cell>>,
  emptyValues: readonly string[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const key = `custom.${field.key}`;
    if (!(key in cells)) continue;
    const cell = cells[key];
    if (isEmptyCell(cell, emptyValues)) values[field.key] = null;
    else if (field.type === 'yes_no') values[field.key] = cellYesNo(cell) ?? cellText(cell);
    else if (field.type === 'multi_select') {
      values[field.key] = cellText(cell)
        .split(/[,;]/)
        .map((part) => part.trim())
        .filter(Boolean);
    } else if (field.type === 'date') values[field.key] = cellDate(cell) ?? cellText(cell);
    else values[field.key] = cellText(cell);
  }
  return values;
}

/** A field an import can fill. */
export interface ImportField {
  key: string;
  /** Names that mean it in a header, besides its key: its label, and its aliases. */
  names: readonly string[];
  required: boolean;
}

/**
 * The header row: of the first rows, the one whose cells name the most fields. With none naming
 * a field, the first row with at least two cells of text.
 */
export function findHeaderRow(rows: readonly Cell[][], fields: readonly ImportField[]): number {
  const known = new Set(
    fields.flatMap((field) => [field.key, ...field.names].map(normaliseHeader)),
  );
  let best = -1;
  let bestScore = 0;
  rows.slice(0, HEADER_SEARCH_ROWS).forEach((row, index) => {
    const score = row.filter((cell) => known.has(normaliseHeader(cellText(cell)))).length;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  if (best >= 0) return best;
  const texty = rows
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((row) => row.filter((cell) => /\p{L}/u.test(cellText(cell))).length >= 2);
  return Math.max(texty, 0);
}

/**
 * Which field each header means: a saved mapping first (newest first), then a field's key, label
 * or alias. A field goes to one header at most; anything unmatched stays unmapped.
 */
export function suggestMapping(
  headers: readonly string[],
  fields: readonly ImportField[],
  saved: readonly Record<string, string>[],
): Record<string, string | null> {
  const fieldKeys = new Set(fields.map((field) => field.key));
  const byName = new Map<string, string>();
  for (const field of fields) {
    for (const name of [field.key, ...field.names]) {
      const normal = normaliseHeader(name);
      if (normal && !byName.has(normal)) byName.set(normal, field.key);
    }
  }
  const taken = new Set<string>();
  const mapping: Record<string, string | null> = {};
  for (const header of headers) {
    const normal = normaliseHeader(header);
    const fromSaved = saved.map((entry) => entry[normal]).find((key) => key && fieldKeys.has(key));
    const key = fromSaved ?? byName.get(normal) ?? null;
    mapping[header] = key && !taken.has(key) ? key : null;
    if (key) taken.add(key);
  }
  return mapping;
}
