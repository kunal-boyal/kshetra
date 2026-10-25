import { describe, expect, it } from 'vitest';
import { invoicePdf } from './invoice-pdf';

const INVOICE = {
  id: '01a10000-0000-7000-8000-0000000000e1',
  tenantId: '01a10000-0000-7000-8000-0000000000b1',
  subscriptionId: '01a10000-0000-7000-8000-0000000000d1',
  number: 'TL/26-27/00042',
  kind: 'monthly' as const,
  periodFrom: '2026-10-01',
  periodTo: '2026-10-31',
  issuedOn: '2026-11-04',
  dueOn: '2026-11-19',
  seller: {
    legalName: 'Example Field Software Private Limited (fictional)',
    gstin: '27ZZZZZ0000Z1ZQ',
    address: 'Unit 4, Example Business Park, Baner, Pune 411045',
    stateCode: '27',
    stateName: 'Maharashtra',
    email: 'billing@example.com',
    sac: '998314',
  },
  buyer: {
    legalName: 'Sunrise Agro Private Limited',
    gstin: null,
    address: 'Plot 9, MIDC, Nashik 422010',
    stateCode: '27',
    stateName: 'Maharashtra',
  },
  lines: [
    {
      description: 'Seats on the Growth plan, October 2026 (per seat per month, prorated by day)',
      quantity: '11.4839',
      rate: '499.00',
      amount: '5730.47',
    },
  ],
  subtotal: '5730.47',
  gstRate: '18.0000',
  cgst: '515.74',
  sgst: '515.74',
  igst: '0.00',
  total: '6761.95',
  status: 'issued' as const,
  example: true,
  chargeFailedAt: null,
  providerRef: null,
  createdAt: new Date('2026-11-04T00:30:00Z'),
};

describe('invoice PDFs (BR-47)', () => {
  it('draws a one-page A4 PDF of what was issued', async () => {
    const file = await invoicePdf(INVOICE);
    expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(file.length).toBeGreaterThan(1500);
  });
});
