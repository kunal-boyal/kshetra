import { describe, expect, it } from 'vitest';
import { csvField, csvLine, exportExpiry, neutraliseFormula } from './reports';

describe('cells safe to open in a spreadsheet (M18)', () => {
  it('never start with a formula', () => {
    expect(neutraliseFormula('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    expect(neutraliseFormula('+91 98765')).toBe("'+91 98765");
    expect(neutraliseFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutraliseFormula('\tcmd')).toBe("'\tcmd");
    expect(neutraliseFormula('Sharma Stores')).toBe('Sharma Stores');
  });

  it('leave plain numbers alone, negative ones too', () => {
    expect(neutraliseFormula('-12.50')).toBe('-12.50');
    expect(neutraliseFormula('-')).toBe("'-");
  });
});

describe('CSV (M18)', () => {
  it('quotes what needs quoting and ends lines with CRLF', () => {
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField(null)).toBe('');
    expect(csvField(12.5)).toBe('12.5');
    expect(csvLine(['x', 1, true, null])).toBe('x,1,true,\r\n');
  });
});

describe('export files', () => {
  it('are kept for seven days', () => {
    expect(exportExpiry(new Date('2026-10-22T10:00:00Z')).toISOString()).toBe(
      '2026-10-29T10:00:00.000Z',
    );
  });
});
