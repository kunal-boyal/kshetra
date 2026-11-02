# Statutory rates (decision D128)

The reference rate sets in `packages/shared/src/statutory-reference.ts` give the starting figures for statutory payroll. The vendor keeps the sets actually in force in the console (`directory.platform_settings`, key `statutory_rates`), each from a date. Sets are only ever added, and a payslip keeps the set it was worked out on.

**Every figure below awaits review by a chartered accountant.** Until a review is recorded for the rules' current version and the set in use, every payroll screen and payslip says so (`payroll.awaiting_review`).

The figures were checked on 2026-11-02 against the sources listed, most of them secondary compliance guides citing the notifications. The reviewer should confirm each against the notification itself, and in particular the items marked **to confirm**.

## Sets

| Set | From | What changes |
|---|---|---|
| `reference-2026-04` | 2026-04-01 | FY 2026-27, EPF wage ceiling ₹15,000 |
| `reference-2026-09` | 2026-09-17 | EPF wage ceiling ₹25,000 (S.O. 5109(E)), with EPS and EDLI on the same ceiling |

A month takes the set in force on its last day, so September 2026, the split month, takes the ₹25,000 set. Payroll providers prorate that month instead. **To confirm** how the reviewer wants it treated.

## EPF (BR-57)

- **Employee:** 12% of PF wages, on the ceiling unless the person and employer opted for the full wage.
- **Employer:** 12% in all. Of it, 8.33% of wages up to the ceiling goes to EPS; the rest is EPF.
- **EDLI:** 0.5% of wages up to the ceiling. **Administration:** 0.5% of PF wages.
- **Rounding:** each share to the rupee.
- **Ceiling:** ₹15,000 until 16 September 2026, then ₹25,000. The Cabinet approved the change on 16 September 2026, and it took effect from 17 September 2026 ([SCC Online](https://www.scconline.com/blog/post/2026/09/17/cabinet-approves-epfo-wage-ceiling-limit-from-15000-to-25000/), [KPMG](https://kpmg.com/xx/en/our-insights/gms-flash-alert/2026/flash-alert-2026-249.html), [Business Standard on EPS and EDLI](https://www.business-standard.com/amp/finance/personal-finance/rs-25-000-epf-ceiling-how-pf-eps-pension-and-edli-insurance-change-126091800797_1.html)).
- **To confirm:**
  - EPS for members over 58;
  - the administration charge's minimum per establishment;
  - the EDLI ceiling after the change.

## ESI (BR-57)

- **Shares:** the employee pays 0.75% and the employer 3.25% of wages, each rounded up to the rupee.
- **Coverage:** a person is covered when their wages at the start of a contribution period (April to September, October to March) are ₹21,000 or less, and stays covered to the period's end.
- **Daily floor:** at or below an average daily wage of ₹176 (monthly wages ÷ 26), the employee pays nothing.
- **Wages** follow the Code on Social Security's definition from 21 November 2025, the same as for PF ([ApnaSalary](https://www.apnasalary.in/guides/esic-contribution-rules-2026), [HR Tailor](https://hrtailor.com/esic-wage-ceiling-2026-employer-guide/), [Safepoint](https://safepoint.co.in/esic-contribution-rate)).
- **To confirm:**
  - the exempt daily wage: sources give ₹176 and ₹137;
  - the divisor for the daily average.

## Wages under the labour codes (BR-56)

- **What counts:** basic, DA, special allowance and allowances not excluded.
- **The 50% rule:** when the excluded allowances (HRA, conveyance and those marked) come to more than half the remuneration, the excess counts as wages ([ApnaSalary](https://www.apnasalary.in/guides/esic-contribution-rules-2026)).
- **To confirm:** which of a tenant's own allowances are excluded, which the structure marks one by one.

## Professional tax (BR-57)

| State | Basis | Slabs (monthly unless stated) |
|---|---|---|
| Maharashtra | Monthly gross | Nil to ₹7,500; ₹175 from ₹7,501; ₹200 from ₹10,001, with ₹300 in February. Women nil to ₹25,000, then ₹200 (₹300 in February) |
| Karnataka | Monthly gross | ₹200 from ₹25,000, with ₹300 in February (Karnataka Act 33 of 2025, from 1 April 2025) |
| Gujarat | Monthly gross | ₹200 from ₹12,000 |
| Telangana | Monthly gross | ₹150 from ₹15,001; ₹200 from ₹20,001 |
| Madhya Pradesh | Yearly gross (monthly × 12) | ₹125 from ₹2,25,001; ₹166 from ₹3,00,001 (₹174 in March); ₹208 from ₹4,00,001 (₹212 in March) |

Sources: [HROne](https://hrone.cloud/blog/professional-tax-slab-rates-2026-27/), [Lexplosion on Karnataka](https://lexplosion.in/karnataka-govt-notifies-revised-professional-tax-rate-under-karnataka-tax-on-profession-trades-callings-and-employments-amendment-act-2025/), [factoHR on Madhya Pradesh](https://factohr.com/professional-tax/madhya-pradesh/).

**To confirm:**
- Maharashtra's slab for women;
- Gujarat's annual total;
- whether exemptions (people with disabilities, the armed forces) apply to a tenant's people.

## Labour welfare fund (BR-57)

| State | Months | Employee | Employer |
|---|---|---|---|
| Maharashtra | June, December | ₹25 | ₹75 |
| Karnataka | December | ₹50 | ₹100 |
| Madhya Pradesh | June, December | ₹10 | ₹50 |
| Gujarat | June, December | ₹6 | ₹12 |
| Telangana | December | ₹2 | ₹5 |

Sources: [Patron Accounting](https://www.patronaccounting.com/blog/labour-welfare-fund-india-contribution-rates-due-dates), [CalcGuru on Madhya Pradesh's January 2026 notification](https://calcguru.in/?p=8414).

**To confirm:**
- Madhya Pradesh's employer share: ₹30 before the notification of 28 January 2026, ₹50 after it, from a single source;
- each state's wage conditions, which the rules don't apply yet (Maharashtra's lower rate at low wages, Madhya Pradesh's exemption above a wage);
- Karnataka's coverage from 7 January 2026 (10 or more employees).

## TDS on salary, new regime (BR-58)

- **Deduction:** a standard deduction of ₹75,000.
- **Slabs:** nil to ₹4 lakh; 5% to ₹8 lakh; 10% to ₹12 lakh; 15% to ₹16 lakh; 20% to ₹20 lakh; 25% to ₹24 lakh; 30% above.
- **Rebate:** up to ₹60,000 for income up to ₹12 lakh, with marginal relief above it. Section 87A becomes section 156 of the Income-tax Act, 2025, from tax year 2026-27.
- **Cess:** 4% health and education cess.
- **Monthly TDS:** the year's tax, less what was already deducted, spread over the months left ([ClearTax](https://cleartax.in/s/income-tax-slabs), [FilingSetu on 87A and marginal relief](https://filingsetu.in/blog/section-87a-rebate), [Indian Pay Calculator on the 2025 Act](https://www.indianpaycalculator.in/income-tax-slabs)).
- **Flagged for the accountant, not worked out in v1:**
  - surcharge above ₹50 lakh;
  - TDS without a PAN on file;
  - other income and a previous employer's salary.
- **To confirm:**
  - the 2025 Act's section numbers on the payslip;
  - rounding of the year's tax (to the rupee here; section 288B rounds to ten).
