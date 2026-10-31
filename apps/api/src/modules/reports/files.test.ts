import type { ReportColumn } from '@thelamp/shared';
import readXlsxFile from 'read-excel-file/node';
import { describe, expect, it } from 'vitest';
import { fieldCell } from './activity-log';
import { toCsv, toWorkbook, toXlsx, wallClock } from './files';

const COLUMNS: ReportColumn[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'when', label: 'When', kind: 'datetime' },
  { key: 'amount', label: 'Amount', kind: 'decimal' },
];
const ROWS = [
  { name: '=cmd|"/c calc"!A1', when: '2026-10-22T04:00:00.000Z', amount: '-1250.50' },
  { name: 'Sharma, Stores', when: null, amount: null },
];

describe('export files (M18)', () => {
  it('write moments on the tenant’s clock', () => {
    expect(wallClock('2026-10-22T20:00:00.000Z', 'Asia/Kolkata')).toBe('2026-10-23 01:30');
  });

  it('write CSV with a byte-order mark, quoting, and no formulas', () => {
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      toCsv(COLUMNS, ROWS, 'Asia/Kolkata'),
    );
    expect(text).toBe(
      '﻿Name,When,Amount\r\n' +
        `"'=cmd|""/c calc""!A1",2026-10-22 09:30,-1250.50\r\n` +
        '"Sharma, Stores",,\r\n',
    );
  });

  it('write XLSX with numbers as numbers and text that never runs', async () => {
    const bytes = await toXlsx('Activity log: October', COLUMNS, ROWS, 'Asia/Kolkata');
    const [sheet] = await readXlsxFile(Buffer.from(bytes));
    expect(sheet!.sheet).toBe('Activity log  October');
    expect(sheet!.data[0]).toEqual(['Name', 'When', 'Amount']);
    expect(sheet!.data[1]![0]).toBe(`'=cmd|"/c calc"!A1`);
    expect(sheet!.data[1]![2]).toBe(-1250.5);
  });

  it('write every report as a sheet of one workbook, each name unlike the others (D112)', async () => {
    const long = 'Targets against achievement for the whole team';
    const bytes = await toWorkbook(
      [
        { name: long, columns: COLUMNS, rows: ROWS },
        { name: long, columns: COLUMNS, rows: [] },
        { name: 'Leave register', columns: COLUMNS, rows: ROWS.slice(1) },
      ],
      'Asia/Kolkata',
    );
    const sheets = await readXlsxFile(Buffer.from(bytes));
    expect(sheets.map((entry) => entry.sheet)).toEqual([
      long.slice(0, 31),
      `${long.slice(0, 29)} 2`,
      'Leave register',
    ]);
    expect(sheets[1]!.data).toEqual([['Name', 'When', 'Amount']]);
    expect(sheets[2]!.data[1]![0]).toBe('Sharma, Stores');
  });
});

describe('form values in the activity log (M18)', () => {
  const label = { en: 'Purpose', hi: 'उद्देश्य' };
  it('read options by their label, lists joined, and photos counted', () => {
    const select = {
      key: 'purpose',
      type: 'single_select' as const,
      label,
      required: false,
      options: [{ key: 'follow_up', label: { en: 'Follow-up', hi: 'फ़ॉलो-अप' } }],
    };
    expect(fieldCell(select, 'follow_up', 'hi')).toBe('फ़ॉलो-अप');
    expect(fieldCell({ ...select, type: 'multi_select' as const }, ['follow_up', 'x'], 'en')).toBe(
      'Follow-up, x',
    );
    expect(
      fieldCell(
        {
          key: 'shelf',
          type: 'photo',
          label,
          required: false,
          min: 0,
          max: 3,
          source: 'camera',
        } as never,
        ['a', 'b'],
        'en',
      ),
    ).toBe(2);
    expect(fieldCell(select, '', 'en')).toBeNull();
  });
});
