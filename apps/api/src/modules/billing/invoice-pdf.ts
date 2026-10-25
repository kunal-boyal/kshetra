import { formatNumber } from '@thelamp/i18n';
import { scaled, unscaled } from '@thelamp/shared';
import PDFDocument from 'pdfkit';
import type { invoices } from '../../db/schema/directory';
import { percent } from './invoices.service';
import { printed } from './tenant-billing.service';

type InvoiceRow = typeof invoices.$inferSelect;

/** An amount as Indian invoices print it: 1,23,456.00, in rupees (the heading says INR). */
const amount = (value: string) =>
  formatNumber(value as `${number}`, { locale: 'en' }, { minimumFractionDigits: 2 });

const quantity = (value: string) =>
  formatNumber(value as `${number}`, { locale: 'en' }, { maximumFractionDigits: 4 });

const MARGIN = 48;
const WIDTH = 595.28 - MARGIN * 2;

/**
 * A GST tax invoice as a PDF (BR-47, decision D90), drawn from the stored invoice whenever it is
 * asked for, so it always says exactly what was issued. One A4 page in the standard Helvetica,
 * English only, amounts in INR; an invoice issued on the example seller says it is not a tax
 * invoice.
 */
export function invoicePdf(invoice: InvoiceRow): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: { Title: `Invoice ${invoice.number}`, Author: invoice.seller.legalName },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const { seller, buyer } = invoice;
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(invoice.example ? 'EXAMPLE: NOT A TAX INVOICE' : 'TAX INVOICE', { align: 'right' });
  doc.moveDown(0.5);
  doc.fontSize(12).text(seller.legalName);
  doc.font('Helvetica').fontSize(9).text(seller.address);
  if (seller.gstin) doc.text(`GSTIN: ${seller.gstin}`);
  doc.text(`State: ${seller.stateName} (${seller.stateCode})`);
  doc.text(seller.email);

  doc.moveDown();
  const facts: [string, string][] = [
    ['Invoice number', invoice.number],
    ['Invoice date', printed(invoice.issuedOn)],
    ['Due date', printed(invoice.dueOn)],
    ['Period', `${printed(invoice.periodFrom)} to ${printed(invoice.periodTo)}`],
    ['Place of supply', `${buyer.stateName} (${buyer.stateCode})`],
  ];
  for (const [label, value] of facts) {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
    doc.font('Helvetica').text(value);
  }

  doc.moveDown();
  doc.font('Helvetica-Bold').text('Bill to');
  doc.font('Helvetica').text(buyer.legalName).text(buyer.address);
  if (buyer.gstin) doc.text(`GSTIN: ${buyer.gstin}`);
  doc.text(`State: ${buyer.stateName} (${buyer.stateCode})`);

  // The lines: description, SAC, quantity, rate and amount.
  doc.moveDown();
  const columns = [
    { title: 'Description', width: WIDTH - 250, align: 'left' as const },
    { title: 'SAC', width: 50, align: 'left' as const },
    { title: 'Quantity', width: 60, align: 'right' as const },
    { title: 'Rate (INR)', width: 70, align: 'right' as const },
    { title: 'Amount (INR)', width: 70, align: 'right' as const },
  ];
  const row = (cells: string[], bold: boolean) => {
    const top = doc.y;
    let x = MARGIN;
    let bottom = top;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
    cells.forEach((cell, index) => {
      const column = columns[index]!;
      doc.text(cell, x, top, { width: column.width - 6, align: column.align });
      bottom = Math.max(bottom, doc.y);
      x += column.width;
    });
    doc.y = bottom + 4;
    doc
      .moveTo(MARGIN, doc.y - 2)
      .lineTo(MARGIN + WIDTH, doc.y - 2)
      .lineWidth(0.5)
      .strokeColor('#999999')
      .stroke();
  };
  row(
    columns.map((column) => column.title),
    true,
  );
  for (const line of invoice.lines) {
    row(
      [
        line.description,
        seller.sac,
        quantity(line.quantity),
        amount(line.rate),
        amount(line.amount),
      ],
      false,
    );
  }

  // The totals, with GST as the place of supply decides it.
  doc.moveDown();
  const rate = percent(invoice.gstRate);
  // Half the rate, exactly: four places halved is five.
  const half = percent(unscaled(scaled(invoice.gstRate, 4) * 5n, 5));
  const totals: [string, string][] = [['Taxable value', invoice.subtotal]];
  if (scaled(invoice.igst, 2) > 0n || scaled(invoice.cgst, 2) === 0n) {
    totals.push([`IGST at ${rate}%`, invoice.igst]);
  } else {
    totals.push([`CGST at ${half}%`, invoice.cgst], [`SGST at ${half}%`, invoice.sgst]);
  }
  totals.push(['Total (INR)', invoice.total]);
  totals.forEach(([label, value], index) => {
    const last = index === totals.length - 1;
    const top = doc.y;
    doc.font(last ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(label, MARGIN + WIDTH - 260, top, { width: 180, align: 'right' });
    doc.text(amount(value), MARGIN + WIDTH - 80, top, { width: 80, align: 'right' });
    doc.moveDown(0.3);
  });

  doc.moveDown(2);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#555555')
    .text(
      'Amounts are in Indian rupees (INR). Tax is not payable on reverse charge. This is a computer-generated invoice.',
      MARGIN,
      doc.y,
      { width: WIDTH },
    );
  doc.end();
  return done;
}
