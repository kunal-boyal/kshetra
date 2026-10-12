import { describe, expect, it } from 'vitest';
import {
  cellDate,
  cellText,
  cellYesNo,
  fileKind,
  findHeaderRow,
  type ImportField,
  isEmptyCell,
  readRows,
  suggestMapping,
  UnreadableFileError,
} from './reading';
import { xlsx } from './xlsx.test-support';

const FIELDS: ImportField[] = [
  { key: 'code', names: ['Employee code'], required: true },
  { key: 'name', names: ['Name'], required: true },
  { key: 'mobile', names: ['Mobile', 'phoneno'], required: false },
  { key: 'reports_to', names: ['Reports to', 'manager'], required: false },
];

describe('reading a file (M19)', () => {
  it('knows CSV and XLSX by name or type, and nothing else', () => {
    expect(fileKind('people.CSV', 'application/octet-stream')).toBe('csv');
    expect(fileKind('x', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(
      'xlsx',
    );
    expect(fileKind('people.xls', 'application/vnd.ms-excel')).toBeNull();
    expect(fileKind('people.txt', 'text/csv')).toBeNull();
  });

  it('reads CSV rows, quotes and all', async () => {
    const csv = '﻿Employee code,Name\nSUN-1,"Rao, Anita"\n';
    expect((await readRows(new TextEncoder().encode(csv), 'csv')).rows).toEqual([
      ['Employee code', 'Name'],
      ['SUN-1', 'Rao, Anita'],
    ]);
  });

  it('reads the first sheet of a workbook, or the one named, keeping numbers as written', async () => {
    const book = xlsx({
      Notes: [['Exported on 6 Oct']],
      People: [
        ['Employee code', 'Mobile'],
        ['SUN-1', 9876543210],
      ],
    });
    const first = await readRows(book, 'xlsx');
    expect(first).toEqual({
      sheets: ['Notes', 'People'],
      sheet: 'Notes',
      rows: [['Exported on 6 Oct']],
    });
    const people = await readRows(book, 'xlsx', 'People');
    expect(people.rows).toEqual([
      ['Employee code', 'Mobile'],
      ['SUN-1', '9876543210'],
    ]);
    await expect(readRows(book, 'xlsx', 'Missing')).rejects.toThrow(UnreadableFileError);
    await expect(readRows(new TextEncoder().encode('not a zip'), 'xlsx')).rejects.toThrow(
      UnreadableFileError,
    );
  });

  it('finds the header among the first rows, by the fields it names', () => {
    const rows = [
      ['Sunrise Traders staff list'],
      [],
      ['Employee code', 'Name', 'Phone No'],
      ['A', 'B', 'C'],
    ];
    expect(findHeaderRow(rows, FIELDS)).toBe(2);
    expect(findHeaderRow([['Title'], ['Alpha', 'Beta'], ['1', '2']], FIELDS)).toBe(1);
  });

  it('suggests a field for each header, saved mappings first, each field once', () => {
    expect(
      suggestMapping(
        ['Emp ID', 'Name', 'Phone No.', 'Manager', 'Manager name', 'Remarks'],
        FIELDS,
        [{ empid: 'code' }],
      ),
    ).toEqual({
      'Emp ID': 'code',
      Name: 'name',
      'Phone No.': 'mobile',
      Manager: 'reports_to',
      'Manager name': null,
      Remarks: null,
    });
  });
});

describe('cells (Appendix B)', () => {
  it('reads text without Excel’s trailing .0, and treats listed values as empty', () => {
    expect(cellText(' 9876543210.0 ')).toBe('9876543210');
    expect(cellText('12.50')).toBe('12.50');
    expect(isEmptyCell('-', ['-'])).toBe(true);
    expect(isEmptyCell('  ')).toBe(true);
  });

  it('reads dates as date cells, Excel serials, YYYY-MM-DD and DD-MM-YYYY', () => {
    expect(cellDate(new Date(Date.UTC(2026, 3, 1)))).toBe('2026-04-01');
    expect(cellDate('46113')).toBe('2026-04-01');
    expect(cellDate('2026-04-01')).toBe('2026-04-01');
    expect(cellDate('01/04/2026')).toBe('2026-04-01');
    expect(cellDate('31-02-2026')).toBeNull();
    expect(cellDate('April')).toBeNull();
  });

  it('reads yes and no in English and Hindi', () => {
    expect([cellYesNo('Yes'), cellYesNo('n'), cellYesNo('हाँ'), cellYesNo('maybe')]).toEqual([
      true,
      false,
      true,
      null,
    ]);
  });
});
