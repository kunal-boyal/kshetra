import { describe, expect, it } from 'vitest';
import { StatutoryRateSet } from './schemas/statutory';
import {
  esiCovered,
  esiFor,
  esiPeriodStart,
  lwfFor,
  monthsAfterInYear,
  payslipFor,
  pfFor,
  ptFor,
  type SalaryStructure,
  structureWages,
  tdsFor,
  yearlyTax,
} from './statutory';
import { REFERENCE_RATE_SETS } from './statutory-reference';

const [APRIL, SEPTEMBER] = REFERENCE_RATE_SETS as [StatutoryRateSet, StatutoryRateSet];
const RATES = APRIL.rates;

const structure = (patch: Partial<SalaryStructure>): SalaryStructure => ({
  basic: '0',
  da: '0',
  hra: '0',
  conveyance: '0',
  special: '0',
  others: [],
  ...patch,
});

describe('BR-56 to BR-58: statutory payroll', () => {
  it('keeps reference sets that parse as rate sets', () => {
    for (const set of REFERENCE_RATE_SETS) expect(StatutoryRateSet.parse(set)).toEqual(set);
  });

  it('FX-59: PF on the ceiling, below it, and on the full wage by option', () => {
    // 12,000: 12% is 1,440 each; EPS 8.33% is 999.60, 1,000; EPF 440; EDLI and admin 60.
    expect(pfFor('12000', RATES.pf, false)).toEqual({
      employee: '1440.00',
      employerEpf: '440.00',
      eps: '1000.00',
      edli: '60.00',
      admin: '60.00',
    });
    // 15,000: 1,800 each; EPS 1,249.50 rounds to 1,250; EPF 550; EDLI and admin 75.
    expect(pfFor('15000', RATES.pf, false)).toMatchObject({
      employee: '1800.00',
      employerEpf: '550.00',
      eps: '1250.00',
    });
    // 20,000 without the option: still on 15,000.
    expect(pfFor('20000', RATES.pf, false)).toEqual(pfFor('15000', RATES.pf, false));
    // With it: 2,400 each, EPS still on the ceiling, admin on the full wage.
    expect(pfFor('20000', RATES.pf, true)).toEqual({
      employee: '2400.00',
      employerEpf: '1150.00',
      eps: '1250.00',
      edli: '75.00',
      admin: '100.00',
    });
    // From 17 September 2026 the ceiling is 25,000: 20,000 is wholly within it.
    expect(pfFor('20000', SEPTEMBER.rates.pf, false)).toEqual({
      employee: '2400.00',
      employerEpf: '734.00',
      eps: '1666.00',
      edli: '100.00',
      admin: '100.00',
    });
  });

  it('FX-60, FX-62: covers ESI at the limit and not a rupee above it, for the whole period', () => {
    expect(esiCovered('21000', RATES.esi)).toBe(true);
    expect(esiCovered('21001', RATES.esi)).toBe(false);
    expect(esiPeriodStart('2026-11')).toBe('2026-10');
    expect(esiPeriodStart('2027-02')).toBe('2026-10');
    expect(esiPeriodStart('2026-05')).toBe('2026-04');
  });

  it('FX-61: takes ESI rounded up to the rupee, and nothing from the employee under the daily floor', () => {
    // 18,000: 135.00 and 585.00.
    expect(esiFor('18000', RATES.esi)).toEqual({ employee: '135.00', employer: '585.00' });
    // 15,500: 116.25 up to 117; 503.75 up to 504.
    expect(esiFor('15500', RATES.esi)).toEqual({ employee: '117.00', employer: '504.00' });
    // 4,500 is 173.08 a day, under 176: the employer's 146.25 up to 147 only.
    expect(esiFor('4500', RATES.esi)).toEqual({ employee: '0.00', employer: '147.00' });
  });

  it('FX-63: counts excluded allowances above half the remuneration as wages', () => {
    // 25,000 with 12,000 excluded: wages are basic and special, 13,000.
    expect(
      structureWages(
        structure({ basic: '10000', hra: '8000', conveyance: '4000', special: '3000' }),
      ),
    ).toBe('13000.00');
    // 25,000 with 17,000 excluded: 4,500 over half comes back, wages 12,500.
    expect(
      structureWages(
        structure({
          basic: '8000',
          hra: '10000',
          conveyance: '4000',
          others: [{ key: 'lta', amount: '3000', excluded: true }],
        }),
      ),
    ).toBe('12500.00');
  });

  it('FX-64: Maharashtra professional tax by slab, February and the slab for women', () => {
    const pt = (gross: string, month: number, women = false) =>
      ptFor({ gross, yearlyGross: '0', month, women }, RATES.pt.MH);
    expect(pt('7500', 11)).toBe('0.00');
    expect(pt('9000', 11)).toBe('175.00');
    expect(pt('15000', 11)).toBe('200.00');
    expect(pt('15000', 2)).toBe('300.00');
    expect(pt('20000', 11, true)).toBe('0.00');
    expect(pt('30000', 2, true)).toBe('300.00');
  });

  it('FX-65: Karnataka, Gujarat and Telangana by their monthly slabs', () => {
    const pt = (state: 'KA' | 'GJ' | 'TS', gross: string, month = 11) =>
      ptFor({ gross, yearlyGross: '0', month, women: false }, RATES.pt[state]);
    expect(pt('KA', '24999')).toBe('0.00');
    expect(pt('KA', '25000')).toBe('200.00');
    expect(pt('KA', '25000', 2)).toBe('300.00');
    expect(pt('GJ', '11999')).toBe('0.00');
    expect(pt('GJ', '12000')).toBe('200.00');
    expect(pt('TS', '18000')).toBe('150.00');
    expect(pt('TS', '25000')).toBe('200.00');
  });

  it('FX-66: Madhya Pradesh on the year’s gross, and each fund only in its months', () => {
    const pt = (yearlyGross: string, month: number) =>
      ptFor({ gross: '0', yearlyGross, month, women: false }, RATES.pt.MP);
    expect(pt('216000', 11)).toBe('0.00');
    expect(pt('240000', 11)).toBe('125.00');
    expect(pt('360000', 11)).toBe('166.00');
    expect(pt('360000', 3)).toBe('174.00');
    expect(pt('480000', 3)).toBe('212.00');
    expect(lwfFor(6, RATES.lwf.MH)).toEqual({ employee: '25.00', employer: '75.00' });
    expect(lwfFor(7, RATES.lwf.MH)).toEqual({ employee: '0.00', employer: '0.00' });
    expect(lwfFor(12, RATES.lwf.KA)).toEqual({ employee: '50.00', employer: '100.00' });
  });

  it('FX-67: TDS spread over the year from April, and nothing for someone joining in October under the rebate', () => {
    expect(monthsAfterInYear('2026-04')).toBe(11);
    expect(monthsAfterInYear('2026-10')).toBe(5);
    expect(monthsAfterInYear('2027-01')).toBe(2);
    expect(monthsAfterInYear('2027-03')).toBe(0);
    // 1,50,000 a month: 18,00,000 less 75,000 is 17,25,000. Tax 20,000 + 40,000 + 60,000 +
    // 25,000 = 1,45,000; cess 5,800; 1,50,800 over 12 months is 12,566.67, so 12,567.
    expect(
      tdsFor(
        {
          paidBefore: '0',
          deductedBefore: '0',
          thisMonth: '150000',
          monthlyGross: '150000',
          monthsAfter: 11,
        },
        RATES.tds,
      ),
    ).toEqual({
      tds: '12567.00',
      yearlyIncome: '1725000.00',
      yearlyTax: '150800.00',
      surcharge: false,
    });
    // 1,00,000 from October: 6,00,000 less 75,000 is 5,25,000, under the rebate's limit.
    expect(
      tdsFor(
        {
          paidBefore: '0',
          deductedBefore: '0',
          thisMonth: '100000',
          monthlyGross: '100000',
          monthsAfter: 5,
        },
        RATES.tds,
      ).tds,
    ).toBe('0.00');
  });

  it('FX-68: TDS after a raise in January takes what is left over the months left', () => {
    // Nine months at 1,50,000 paid 13,50,000 and deducted 9 × 12,567 = 1,13,103. From January
    // 2,00,000: 13,50,000 + 2,00,000 + 2 × 2,00,000 = 19,50,000, less 75,000 is 18,75,000. Tax
    // 1,20,000 + 55,000 = 1,75,000; cess 7,000; 1,82,000. Left 68,897 over 3 months: 22,965.67.
    expect(
      tdsFor(
        {
          paidBefore: '1350000',
          deductedBefore: '113103',
          thisMonth: '200000',
          monthlyGross: '200000',
          monthsAfter: 2,
        },
        RATES.tds,
      ),
    ).toMatchObject({ tds: '22966.00', yearlyTax: '182000.00' });
  });

  it('FX-69: the rebate up to 12 lakh, and marginal relief just above it', () => {
    // 12,00,000: slab tax 60,000, wholly rebated.
    expect(yearlyTax('1200000', RATES.tds)).toBe('0.00');
    // 12,10,000: slab tax 61,500, but no more than the 10,000 above the limit; cess 400.
    expect(yearlyTax('1210000', RATES.tds)).toBe('10400.00');
    // 13,00,000: slab tax 75,000 is under the 1,00,000 above the limit; cess 3,000.
    expect(yearlyTax('1300000', RATES.tds)).toBe('78000.00');
  });

  it('works out a month’s payslip in Maharashtra', () => {
    // 25,000: basic 15,000, HRA 6,000, special 4,000; wages 19,000. PF 1,800 on the ceiling;
    // ESI 142.50 up to 143; PT 200; nothing for the fund in November; no TDS under the rebate.
    const payslip = payslipFor({
      period: '2026-11',
      structure: structure({ basic: '15000', hra: '6000', special: '4000' }),
      profile: {
        workState: 'MH',
        ptWomen: false,
        pfMember: true,
        pfFullWage: false,
        panOnFile: true,
      },
      paidHalves: 52,
      scheduled: 26,
      esiCovered: true,
      adjustments: [],
      yearToDate: { paid: '0', tds: '0' },
      rates: RATES,
    });
    expect(payslip).toMatchObject({
      wages: '19000.00',
      gross: '25000.00',
      deductions: [
        { key: 'pf', amount: '1800.00' },
        { key: 'esi', amount: '143.00' },
        { key: 'pt', amount: '200.00' },
      ],
      employer: [
        { key: 'epf', amount: '550.00' },
        { key: 'eps', amount: '1250.00' },
        { key: 'edli', amount: '75.00' },
        { key: 'pf_admin', amount: '75.00' },
        { key: 'esi', amount: '618.00' },
      ],
      totalDeductions: '2143.00',
      net: '22857.00',
      flags: [],
    });
    // Half the month paid: each component halved, PF on 9,500 wages is 1,140.
    const half = payslipFor({
      period: '2026-11',
      structure: structure({ basic: '15000', hra: '6000', special: '4000' }),
      profile: {
        workState: null,
        ptWomen: false,
        pfMember: true,
        pfFullWage: false,
        panOnFile: false,
      },
      paidHalves: 26,
      scheduled: 26,
      esiCovered: false,
      adjustments: [{ key: 'arrears', kind: 'earning', amount: '500' }],
      yearToDate: { paid: '0', tds: '0' },
      rates: RATES,
    });
    expect(half).toMatchObject({
      wages: '9500.00',
      gross: '13000.00',
      deductions: [{ key: 'pf', amount: '1140.00' }],
      flags: ['no_work_state', 'no_pan'],
    });
  });
});
