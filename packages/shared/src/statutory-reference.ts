import type { StatutoryRateSet } from './schemas/statutory';

/**
 * The reference rate sets the vendor starts from (decision D128), checked on 2026-11-02 against
 * the sources in `docs/payroll/statutory-rates.md`. The vendor keeps the sets in force in the
 * console; these apply only until it saves its own, and every figure awaits a chartered
 * accountant's review. Professional tax and the labour welfare fund are for the five states built
 * in; Maharashtra's and Karnataka's February amounts, Madhya Pradesh's annual slabs and March
 * amounts, and each fund's months follow the state rules as summarised there.
 */
const COMMON: Omit<StatutoryRateSet['rates'], 'pf'> = {
  esi: {
    employeePercent: '0.75',
    employerPercent: '3.25',
    wageLimit: '21000',
    exemptDailyWage: '176',
  },
  pt: {
    MH: {
      basis: 'monthly',
      slabs: [
        { from: '7501', amount: '175' },
        { from: '10001', amount: '200', february: '300' },
      ],
      women: [{ from: '25001', amount: '200', february: '300' }],
    },
    KA: { basis: 'monthly', slabs: [{ from: '25000', amount: '200', february: '300' }] },
    GJ: { basis: 'monthly', slabs: [{ from: '12000', amount: '200' }] },
    TS: {
      basis: 'monthly',
      slabs: [
        { from: '15001', amount: '150' },
        { from: '20001', amount: '200' },
      ],
    },
    MP: {
      basis: 'annual',
      slabs: [
        { from: '225001', amount: '125' },
        { from: '300001', amount: '166', march: '174' },
        { from: '400001', amount: '208', march: '212' },
      ],
    },
  },
  lwf: {
    MH: { months: [6, 12], employee: '25', employer: '75' },
    KA: { months: [12], employee: '50', employer: '100' },
    MP: { months: [6, 12], employee: '10', employer: '50' },
    GJ: { months: [6, 12], employee: '6', employer: '12' },
    TS: { months: [12], employee: '2', employer: '5' },
  },
  tds: {
    standardDeduction: '75000',
    slabs: [
      { from: '0', percent: '0' },
      { from: '400000', percent: '5' },
      { from: '800000', percent: '10' },
      { from: '1200000', percent: '15' },
      { from: '1600000', percent: '20' },
      { from: '2000000', percent: '25' },
      { from: '2400000', percent: '30' },
    ],
    rebateLimit: '1200000',
    rebateMax: '60000',
    cessPercent: '4',
    surchargeFrom: '5000000',
  },
};

const PF = {
  employeePercent: '12',
  employerPercent: '12',
  epsPercent: '8.33',
  edliPercent: '0.5',
  adminPercent: '0.5',
};

export const REFERENCE_RATE_SETS: readonly StatutoryRateSet[] = [
  {
    id: 'reference-2026-04',
    from: '2026-04-01',
    rates: { ...COMMON, pf: { ...PF, wageCeiling: '15000' } },
    notes:
      'FY 2026-27 from 1 April 2026. EPF ceiling ₹15,000. To confirm: Madhya Pradesh LWF employer share (₹30 or ₹50 after the January 2026 notification); ESI exempt daily wage (₹137 or ₹176); each fund’s wage conditions.',
  },
  {
    id: 'reference-2026-09',
    from: '2026-09-17',
    rates: { ...COMMON, pf: { ...PF, wageCeiling: '25000' } },
    notes:
      'EPF wage ceiling raised to ₹25,000 from 17 September 2026 (S.O. 5109(E)); EPS and EDLI on the same ceiling. September 2026 is a split month: payroll takes the set in force on its last day. To confirm as for the April set.',
  },
];
