import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTallyFile, readTallyFile, TallyFileRefused, tallyText } from './tally-file';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../../../test/fixtures/tally', name));
const utf16 = (text: string) =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
const refusal = (bytes: Uint8Array) => {
  try {
    readTallyFile(bytes);
  } catch (error) {
    if (error instanceof TallyFileRefused) return error.issue;
    throw error;
  }
  return null;
};

describe('reading a Tally export (BR-61)', () => {
  it('reads the masters: groups, voucher types, ledgers with their aliases, stock items', () => {
    const file = readTallyFile(fixture('masters.xml'));
    expect(file.company).toBe('Sahyadri Agro Inputs');
    expect(file.groups).toContainEqual({ name: 'Debtors - Nashik', parent: 'Sundry Debtors' });
    expect(file.voucherTypes).toEqual([{ name: 'GST Sales', parent: 'Sales' }]);
    expect(file.ledgers.find((ledger) => ledger.aliases.includes('KSK-002'))).toMatchObject({
      name: 'Kisan Seva Kendra & Sons',
      parent: 'Sundry Debtors',
      address: ['Station Road, Baramati'],
      pincode: '413102',
    });
    expect(file.ledgers[0]).toMatchObject({
      guid: '4c7e1f20-0000-4000-8000-000000000101',
      name: 'Shree Ganesh Agencies',
      aliases: ['SGA-014'],
      parent: 'Debtors - Nashik',
      state: 'Maharashtra',
    });
    expect(file.stockItems[0]).toMatchObject({
      name: 'Neem Gold 1 L',
      aliases: ['NG-1L'],
      parent: 'Bio Pesticides',
      baseUnits: 'Nos',
      gst: [{ from: '20170701', hsn: '38089199', rate: '18' }],
      prices: [{ level: 'Dealer', date: '20250401', rate: '410.00/Nos' }],
    });
    expect(file.stockItems.find((item) => item.name === 'Spray Pump 16 L')?.aliases).toEqual([]);
  });

  it('reads vouchers: the party, its signed amount and its bills', () => {
    const file = readTallyFile(fixture('daybook.xml'));
    expect(file.vouchers.map((voucher) => voucher.type)).toEqual([
      'GST Sales',
      'Sales',
      'Sales',
      'Receipt',
      'Journal',
    ]);
    expect(file.vouchers[0]).toMatchObject({
      number: 'SI/25-26/0412',
      date: '20251020',
      party: 'Shree Ganesh Agencies',
      cancelled: false,
      partyAmount: '-23600.00',
      bills: [{ name: 'SI/25-26/0412', type: 'New Ref', creditPeriod: '30 Days' }],
    });
    // A receipt without a party ledger name takes the entry that settles bills.
    expect(file.vouchers[3]).toMatchObject({
      party: 'Shree Ganesh Agencies',
      partyAmount: '30000.00',
    });
    expect(file.vouchers[3]!.bills.map((bill) => bill.type)).toEqual([
      'Agst Ref',
      'Agst Ref',
      'On Account',
    ]);
  });

  it('reads UTF-16 with or without its byte-order mark, and drops Tally’s control characters', () => {
    const text = fixture('masters.xml').toString('utf8');
    expect(readTallyFile(utf16(text)).ledgers).toHaveLength(4);
    expect(readTallyFile(Buffer.from(text, 'utf16le')).stockItems).toHaveLength(3);
    expect(tallyText(Buffer.from('<A>&#4; Any &#x1F;&#38;</A>'))).toBe('<A> Any &#38;</A>');
  });

  it('refuses what isn’t a Tally export, and any declaration, before parsing', () => {
    expect(refusal(Buffer.from('name,code\nA,1\n'))).toBe('not_tally');
    expect(refusal(Buffer.from('<ENVELOPE><BODY/></ENVELOPE>'))).toBe('not_tally');
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]>' +
      '<ENVELOPE><TALLYMESSAGE><LEDGER NAME="&b;"/></TALLYMESSAGE></ENVELOPE>';
    expect(refusal(Buffer.from(bomb))).toBe('declarations');
    expect(() => checkTallyFile('<ENVELOPE><!ENTITY x "y"><TALLYMESSAGE>')).toThrow(
      TallyFileRefused,
    );
  });

  it('refuses a broken message, or one far larger than any master or voucher', () => {
    expect(
      refusal(Buffer.from('<ENVELOPE><TALLYMESSAGE><LEDGER NAME="A"></TALLYMESSAGE></ENVELOPE>')),
    ).toBe('unreadable');
    expect(refusal(Buffer.from('<ENVELOPE><TALLYMESSAGE><LEDGER NAME="A"/></ENVELOPE>'))).toBe(
      'unreadable',
    );
    const huge = `<ENVELOPE><TALLYMESSAGE><LEDGER NAME="A"><ADDRESS.LIST>${'<ADDRESS>x</ADDRESS>'.repeat(120_000)}</ADDRESS.LIST></LEDGER></TALLYMESSAGE></ENVELOPE>`;
    expect(refusal(Buffer.from(huge))).toBe('too_large_part');
  });
});
