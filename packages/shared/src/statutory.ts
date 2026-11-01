/**
 * Statutory payroll (spec M14, BR-56 to BR-58, decision D128) as pure functions: wages under the
 * labour codes, earnings for the days paid, the employee's PF, ESI, professional tax, labour
 * welfare fund and TDS (new regime), and the employer's contributions. Amounts are decimal
 * strings, exact as paise; rates come from the dated set in force, never from here. Awaits review
 * by a chartered accountant before any tenant relies on it.
 */
import { divide, scaled, unscaled } from './pricing';
import type { StatutoryRatesValue } from './schemas/statutory';

/** The rules' version; a review covers one version and one rate set. */
export const STATUTORY_RULES_VERSION = 1;

/** The states whose professional tax and labour welfare fund are built in, by ISO 3166-2 code. */
export const STATUTORY_STATES = ['MH', 'KA', 'MP', 'GJ', 'TS'] as const;
export type StatutoryStateCode = (typeof STATUTORY_STATES)[number];

/** A salary structure's monthly components, from a month (BR-56). */
export interface SalaryStructure {
  basic: string;
  da: string;
  hra: string;
  conveyance: string;
  /** Special allowance is remuneration the codes don't exclude, so it counts as wages. */
  special: string;
  /** Other allowances; `excluded` ones are outside wages up to half the remuneration. */
  others: readonly { key: string; amount: string; excluded: boolean }[];
}

/** What a payslip names on the person's statutory profile. */
export interface StatutoryProfile {
  workState: StatutoryStateCode | null;
  /** Professional tax slabs for women apply where the state sets them. */
  ptWomen: boolean;
  pfMember: boolean;
  /** PF on the full wage rather than the ceiling, by joint option. */
  pfFullWage: boolean;
  panOnFile: boolean;
}

const paise = (amount: string) => scaled(amount, 2);
const rupees = (value: bigint) => unscaled(value, 2);
const sum = (amounts: readonly string[]) =>
  amounts.reduce((total, amount) => total + paise(amount), 0n);
/** `amount × percent ÷ 100`, in paise, half up to the paisa. */
const percentOf = (amount: bigint, percent: string) =>
  divide(amount * scaled(percent, 4), 1_000_000n);
/** Half up to the rupee, as EPFO rounds each share. */
const toRupee = (value: bigint) => divide(value, 100n) * 100n;
/** Up to the next rupee, as ESIC rounds each share. */
const upToRupee = (value: bigint) => ((value + 99n) / 100n) * 100n;
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** Every component of a structure, by key, as monthly amounts. */
export function components(structure: SalaryStructure): { key: string; amount: string }[] {
  return [
    { key: 'basic', amount: structure.basic },
    { key: 'da', amount: structure.da },
    { key: 'hra', amount: structure.hra },
    { key: 'conveyance', amount: structure.conveyance },
    { key: 'special', amount: structure.special },
    ...structure.others.map((other) => ({ key: other.key, amount: other.amount })),
  ].filter((entry) => paise(entry.amount) > 0n);
}

/**
 * BR-56: wages under the labour codes. Basic, DA, special allowance and other allowances not
 * excluded are wages; when the excluded ones (HRA, conveyance and those marked) come to more than
 * half of the whole remuneration, the excess counts as wages too, so wages are never under half.
 */
export function structureWages(structure: SalaryStructure): string {
  const excluded =
    paise(structure.hra) +
    paise(structure.conveyance) +
    sum(structure.others.filter((other) => other.excluded).map((other) => other.amount));
  const total = sum(components(structure).map((entry) => entry.amount));
  const half = divide(total, 2n);
  return rupees(max(total - excluded, half));
}

/**
 * BR-56: each component for the days paid, prorated as BR-26 prorates gross:
 * `round(amount × min(paid, scheduled) ÷ scheduled, 2)`, nothing when nothing is scheduled.
 * `paidHalves` and `scheduled` count half days as halves.
 */
export function earnedFor(
  structure: SalaryStructure,
  paidHalves: number,
  scheduled: number,
): { key: string; amount: string }[] {
  if (scheduled === 0) return components(structure).map((entry) => ({ ...entry, amount: '0.00' }));
  const earned = BigInt(Math.min(paidHalves, scheduled * 2));
  const denominator = BigInt(scheduled * 2);
  return components(structure).map((entry) => ({
    key: entry.key,
    amount: rupees(divide(paise(entry.amount) * earned, denominator)),
  }));
}

/** The employee's and employer's PF for a month's wages (BR-57). */
export interface PfShares {
  employee: string;
  /** The employer's EPF: its 12% less what goes to the pension. */
  employerEpf: string;
  eps: string;
  edli: string;
  admin: string;
}

/**
 * BR-57: PF on the month's earned wages. The employee pays 12% of PF wages, capped at the ceiling
 * unless the person opted for the full wage; the employer pays the same, of which 8.33% of wages
 * up to the ceiling goes to the pension (EPS) and the rest to EPF. EDLI is on wages up to the
 * ceiling, administration on the PF wages. Each share is rounded to the rupee.
 */
export function pfFor(
  wages: string,
  rates: StatutoryRatesValue['pf'],
  fullWage: boolean,
): PfShares {
  const earned = paise(wages);
  const capped = min(earned, paise(rates.wageCeiling));
  const base = fullWage ? earned : capped;
  const employee = toRupee(percentOf(base, rates.employeePercent));
  const employer = toRupee(percentOf(base, rates.employerPercent));
  const eps = min(toRupee(percentOf(capped, rates.epsPercent)), employer);
  return {
    employee: rupees(employee),
    employerEpf: rupees(employer - eps),
    eps: rupees(eps),
    edli: rupees(toRupee(percentOf(capped, rates.edliPercent))),
    admin: rupees(toRupee(percentOf(base, rates.adminPercent))),
  };
}

/** The first month of the ESI contribution period a month falls in: April or October. */
export function esiPeriodStart(period: string): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  if (month >= 4 && month <= 9) return `${year}-04`;
  return month >= 10 ? `${year}-10` : `${year - 1}-10`;
}

/**
 * BR-57: whether ESI covers a person for a contribution period: their monthly wages at its start
 * (or when they joined within it) were at or below the limit. Once covered, they stay covered to
 * the period's end whatever they earn.
 */
export function esiCovered(wagesAtStart: string, rates: StatutoryRatesValue['esi']): boolean {
  return paise(wagesAtStart) <= paise(rates.wageLimit);
}

/**
 * BR-57: ESI on the month's earned wages for someone covered: the employee's 0.75% and the
 * employer's 3.25%, each rounded up to the rupee. At or below the exempt average daily wage
 * (monthly wages ÷ 26) the employee pays nothing.
 */
export function esiFor(
  wages: string,
  rates: StatutoryRatesValue['esi'],
): { employee: string; employer: string } {
  const earned = paise(wages);
  const daily = divide(earned, 26n);
  const exempt = daily <= paise(rates.exemptDailyWage);
  return {
    employee: rupees(exempt ? 0n : upToRupee(percentOf(earned, rates.employeePercent))),
    employer: rupees(upToRupee(percentOf(earned, rates.employerPercent))),
  };
}

/**
 * BR-57: professional tax for a month by the state's slabs: on the month's gross for monthly
 * states, on the yearly gross (the structure's monthly gross × 12) for annual ones, taking
 * February's or March's amount where the slab names one, and the women's slabs where the state
 * sets them. Nothing for a state without slabs.
 */
export function ptFor(
  input: { gross: string; yearlyGross: string; month: number; women: boolean },
  table: StatutoryRatesValue['pt'][StatutoryStateCode],
): string {
  if (!table) return '0.00';
  const slabs = input.women && table.women ? table.women : table.slabs;
  const measure = paise(table.basis === 'annual' ? input.yearlyGross : input.gross);
  const slab = [...slabs]
    .filter((entry) => paise(entry.from) <= measure)
    .sort((a, b) => (paise(b.from) > paise(a.from) ? 1 : -1))[0];
  if (!slab) return '0.00';
  const amount =
    input.month === 2 && slab.february
      ? slab.february
      : input.month === 3 && slab.march
        ? slab.march
        : slab.amount;
  return rupees(paise(amount));
}

/** BR-57: the labour welfare fund in the months the state takes it. */
export function lwfFor(
  month: number,
  table: StatutoryRatesValue['lwf'][StatutoryStateCode],
): { employee: string; employer: string } {
  if (!table || !table.months.includes(month)) return { employee: '0.00', employer: '0.00' };
  return { employee: rupees(paise(table.employee)), employer: rupees(paise(table.employer)) };
}

/** Tax under the new regime on a year's taxable income, before rebate and cess (BR-58). */
function slabTax(income: bigint, slabs: StatutoryRatesValue['tds']['slabs']): bigint {
  const ordered = [...slabs].sort((a, b) => (paise(a.from) > paise(b.from) ? 1 : -1));
  let tax = 0n;
  ordered.forEach((slab, index) => {
    const from = paise(slab.from);
    const next = ordered[index + 1];
    const to = next ? paise(next.from) : income;
    if (income > from) tax += percentOf(min(income, to) - from, slab.percent);
  });
  return tax;
}

/**
 * BR-58: a year's tax under the new regime on `income` (gross less the standard deduction):
 * the slabs, the rebate up to its limit with marginal relief just above it (the tax never more
 * than the income over the limit), then cess, rounded to the rupee.
 */
export function yearlyTax(income: string, rates: StatutoryRatesValue['tds']): string {
  const taxable = paise(income);
  let tax = slabTax(taxable, rates.slabs);
  const limit = paise(rates.rebateLimit);
  if (taxable <= limit) tax = tax > paise(rates.rebateMax) ? tax - paise(rates.rebateMax) : 0n;
  else tax = min(tax, taxable - limit);
  const withCess = tax + percentOf(tax, rates.cessPercent);
  return rupees(toRupee(withCess));
}

/**
 * BR-58: the month's TDS under the new regime. The year's income is projected as what earlier
 * months of the financial year paid, this month's gross, and the structure's gross for each month
 * left after it, less the standard deduction; of the year's tax, what is not yet deducted is
 * spread over the months left, this one included, rounded to the rupee.
 */
export function tdsFor(
  input: {
    paidBefore: string;
    deductedBefore: string;
    thisMonth: string;
    monthlyGross: string;
    /** Months of the financial year after this one. */
    monthsAfter: number;
  },
  rates: StatutoryRatesValue['tds'],
): { tds: string; yearlyIncome: string; yearlyTax: string; surcharge: boolean } {
  const gross =
    paise(input.paidBefore) +
    paise(input.thisMonth) +
    paise(input.monthlyGross) * BigInt(input.monthsAfter);
  const income = max(gross - paise(rates.standardDeduction), 0n);
  const tax = paise(yearlyTax(rupees(income), rates));
  const left = max(tax - paise(input.deductedBefore), 0n);
  return {
    tds: rupees(toRupee(divide(left, BigInt(input.monthsAfter + 1)))),
    yearlyIncome: rupees(income),
    yearlyTax: rupees(tax),
    surcharge: income > paise(rates.surchargeFrom),
  };
}

/** Months of the financial year (April to March) after a month. */
export function monthsAfterInYear(period: string): number {
  const month = Number(period.slice(5, 7));
  return month >= 4 ? 15 - month : 3 - month;
}

/** The financial year's first month for a month: April of its year, or the year before. */
export function financialYearStart(period: string): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return month >= 4 ? `${year}-04` : `${year - 1}-04`;
}

/** Why a payslip needs the accountant's hand, beside what was worked out. */
export const PAYSLIP_FLAGS = ['surcharge', 'no_pan', 'no_work_state', 'no_structure'] as const;
export type PayslipFlag = (typeof PAYSLIP_FLAGS)[number];

/** One line of a payslip. */
export interface PayslipLine {
  key: string;
  amount: string;
}

export interface PayslipFigures {
  wages: string;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employer: PayslipLine[];
  gross: string;
  totalDeductions: string;
  net: string;
  yearlyIncome: string;
  yearlyTax: string;
  flags: PayslipFlag[];
}

/**
 * BR-56 to BR-58: a month's payslip. Earnings are the structure's components for the days paid,
 * with adjustments; PF and ESI are on the earned wages (adjustments outside them), professional
 * tax and the labour welfare fund by the work state, and TDS on the projected year.
 */
export function payslipFor(input: {
  period: string;
  structure: SalaryStructure;
  profile: StatutoryProfile;
  paidHalves: number;
  scheduled: number;
  esiCovered: boolean;
  adjustments: readonly { key: string; kind: 'earning' | 'deduction'; amount: string }[];
  yearToDate: { paid: string; tds: string };
  rates: StatutoryRatesValue;
}): PayslipFigures {
  const { rates, profile } = input;
  const month = Number(input.period.slice(5, 7));
  const earnedComponents = earnedFor(input.structure, input.paidHalves, input.scheduled);
  const earnedOf = (key: string) =>
    earnedComponents.find((entry) => entry.key === key)?.amount ?? '0.00';
  const earnings = [
    ...earnedComponents,
    ...input.adjustments
      .filter((entry) => entry.kind === 'earning')
      .map((entry) => ({ key: entry.key, amount: rupees(paise(entry.amount)) })),
  ];
  const earnedStructure: SalaryStructure = {
    basic: earnedOf('basic'),
    da: earnedOf('da'),
    hra: earnedOf('hra'),
    conveyance: earnedOf('conveyance'),
    special: earnedOf('special'),
    others: input.structure.others.map((other) => ({ ...other, amount: earnedOf(other.key) })),
  };
  const wages = structureWages(earnedStructure);
  const gross = sum(earnings.map((entry) => entry.amount));
  const monthlyGross = sum(components(input.structure).map((entry) => entry.amount));

  const deductions: PayslipLine[] = [];
  const employer: PayslipLine[] = [];
  const flags: PayslipFlag[] = [];
  if (profile.pfMember) {
    const pf = pfFor(wages, rates.pf, profile.pfFullWage);
    deductions.push({ key: 'pf', amount: pf.employee });
    employer.push(
      { key: 'epf', amount: pf.employerEpf },
      { key: 'eps', amount: pf.eps },
      { key: 'edli', amount: pf.edli },
      { key: 'pf_admin', amount: pf.admin },
    );
  }
  if (input.esiCovered) {
    const esi = esiFor(wages, rates.esi);
    deductions.push({ key: 'esi', amount: esi.employee });
    employer.push({ key: 'esi', amount: esi.employer });
  }
  if (profile.workState) {
    deductions.push({
      key: 'pt',
      amount: ptFor(
        {
          gross: rupees(gross),
          yearlyGross: rupees(monthlyGross * 12n),
          month,
          women: profile.ptWomen,
        },
        rates.pt[profile.workState],
      ),
    });
    // Nothing earned, nothing taken for the fund.
    const lwf =
      gross > 0n
        ? lwfFor(month, rates.lwf[profile.workState])
        : { employee: '0.00', employer: '0.00' };
    deductions.push({ key: 'lwf', amount: lwf.employee });
    employer.push({ key: 'lwf', amount: lwf.employer });
  } else {
    flags.push('no_work_state');
  }
  const tds = tdsFor(
    {
      paidBefore: input.yearToDate.paid,
      deductedBefore: input.yearToDate.tds,
      thisMonth: rupees(gross),
      monthlyGross: rupees(monthlyGross),
      monthsAfter: monthsAfterInYear(input.period),
    },
    rates.tds,
  );
  deductions.push({ key: 'tds', amount: tds.tds });
  if (tds.surcharge) flags.push('surcharge');
  if (!profile.panOnFile) flags.push('no_pan');
  deductions.push(
    ...input.adjustments
      .filter((entry) => entry.kind === 'deduction')
      .map((entry) => ({ key: entry.key, amount: rupees(paise(entry.amount)) })),
  );
  const kept = (lines: PayslipLine[]) => lines.filter((line) => paise(line.amount) > 0n);
  const totalDeductions = sum(deductions.map((entry) => entry.amount));
  return {
    wages,
    earnings: kept(earnings),
    deductions: kept(deductions),
    employer: kept(employer),
    gross: rupees(gross),
    totalDeductions: rupees(totalDeductions),
    // Deductions beyond what was earned wait for the accountant rather than make pay negative.
    net: rupees(max(gross - totalDeductions, 0n)),
    yearlyIncome: tds.yearlyIncome,
    yearlyTax: tds.yearlyTax,
    flags,
  };
}
