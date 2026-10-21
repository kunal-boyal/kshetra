import { PassThrough } from 'node:stream';
import { csvLine, neutraliseFormula, type ReportCell, type ReportColumn } from '@kshetra/shared';
import ExcelJS from 'exceljs';
import type { ReportRow } from './sources';

/**
 * Export files (M18, decision D62): CSV and XLSX from a report's columns and rows. Moments are
 * written on the tenant's clock, as spreadsheets have no time zones; text never starts a formula.
 */

/** A moment as the tenant's wall clock reads it: `YYYY-MM-DD HH:mm`. */
export function wallClock(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** The byte-order mark that tells spreadsheets a CSV file is UTF-8. */
const BOM = '\uFEFF';

/** A cell as CSV text holds it. */
function csvCell(column: ReportColumn, value: ReportCell, timeZone: string): ReportCell {
  if (value === null) return null;
  if (column.kind === 'datetime' && typeof value === 'string') return wallClock(value, timeZone);
  return value;
}

/** A CSV file in UTF-8 with a byte-order mark, so spreadsheets read Hindi as written. */
export function toCsv(
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
  timeZone: string,
): Uint8Array {
  const lines = [csvLine(columns.map((column) => column.label))];
  for (const row of rows) {
    lines.push(
      csvLine(columns.map((column) => csvCell(column, row[column.key] ?? null, timeZone))),
    );
  }
  return new TextEncoder().encode(`${BOM}${lines.join('')}`);
}

/** Excel's number formats for the kinds that need one. */
const NUMBER_FORMATS: Partial<Record<ReportColumn['kind'], string>> = {
  date: 'yyyy-mm-dd',
  datetime: 'yyyy-mm-dd hh:mm',
  percent: '0.0',
};

/** A cell as XLSX holds it: numbers as numbers, dates as dates, text made safe. */
function xlsxCell(
  column: ReportColumn,
  value: ReportCell,
  timeZone: string,
): string | number | boolean | Date | null {
  if (value === null) return null;
  switch (column.kind) {
    case 'number':
    case 'decimal':
    case 'percent': {
      const number = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(number) ? number : neutraliseFormula(String(value));
    }
    case 'date':
      return typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value;
    case 'datetime':
      // Excel keeps no zone: write the tenant's wall clock as the moment.
      return typeof value === 'string'
        ? new Date(`${wallClock(value, timeZone).replace(' ', 'T')}:00Z`)
        : value;
    case 'boolean':
      return typeof value === 'boolean' ? value : neutraliseFormula(String(value));
    default:
      return typeof value === 'string' ? neutraliseFormula(value) : value;
  }
}

/** An XLSX workbook of one sheet, written as a stream so a large report stays within memory. */
export async function toXlsx(
  sheetName: string,
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
  timeZone: string,
): Promise<Uint8Array> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream,
    useStyles: true,
    useSharedStrings: false,
  });
  // Sheet names hold at most 31 characters and none of : \ / ? * [ ].
  const sheet = workbook.addWorksheet(sheetName.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = columns.map((column) => ({
    header: neutraliseFormula(column.label),
    key: column.key,
    width: Math.min(40, Math.max(10, column.label.length + 2)),
    ...(NUMBER_FORMATS[column.kind] ? { style: { numFmt: NUMBER_FORMATS[column.kind] } } : {}),
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).commit();
  for (const row of rows) {
    sheet
      .addRow(
        Object.fromEntries(
          columns.map((column) => [
            column.key,
            xlsxCell(column, row[column.key] ?? null, timeZone),
          ]),
        ),
      )
      .commit();
  }
  sheet.commit();
  await workbook.commit();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}
