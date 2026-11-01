# Phase 4 step B5: statutory payslips — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a tenant that runs its payroll here can do three things:

- give each person a salary structure from a month;
- run the month's payroll, which works out earnings for the days paid and the employee's statutory deductions (PF, ESI, professional tax, labour welfare fund and TDS);
- approve the run, which freezes every payslip; each payslip prints through the browser.

The module ships switched off as an add-on. Every screen and payslip says it awaits review by a chartered accountant until the vendor records that review. Filing (ECR, ESI returns, challans, Form 16, Form 24Q) stays with the customer's accountant (D14 as narrowed by D123).

**Kunal's answers (2026-11-01, and "you do it" on 2026-11-02), decision D128:**

| Question | Answer |
|---|---|
| Structure | A salary structure per person from a month, with the labour codes' 50% wage rule |
| PF | 12% of PF wages, on a ₹15,000 ceiling unless the person opted for the full wage |
| ESI | 0.75% (employee) and 3.25% (employer) of gross, for those whose gross is ₹21,000 or less |
| PT and LWF | Maharashtra, Karnataka, Madhya Pradesh, Gujarat and Telangana first |
| TDS | New regime only |
| Pay run | Monthly; approving it freezes printable payslips |
| Rates | Dated configuration |
| Shipping | Off, as an add-on, labelled for advisor review until a CA signs off |
| Not in v1 | ECR, ESI returns, Form 16 |

**Spec:** M14, BR-26; D14, D99, D117, D123, D125. New: BR-56 to BR-58.

## Global constraints

### Rules

Pure functions in `packages/shared/src/statutory.ts`, exact to the paisa through `scaled` and `unscaled`, never `Number`. Each takes the rate set in force for the month.

- **`structureWages(structure)` (BR-56).** Wages are basic plus DA plus retaining allowance. If the excluded allowances (HRA, conveyance and the rest) come to more than 50% of total remuneration, the excess counts as wages.
- **`earnedFor(structure, paidDays, scheduledDays)` (BR-56).** Each component is prorated as BR-26 prorates gross: `round(amount × min(paid, scheduled) ÷ scheduled, 2)`.
- **`pfFor(wages, rates, optedFullWage)` (BR-57).**
  - The employee pays 12% of PF wages, capped at the ceiling (₹15,000) unless the person opted for the full wage.
  - The employer pays 3.67% EPF and 8.33% EPS. EPS is always on the ceiling.
  - Each share is rounded to the rupee, as EPFO does.
- **`esiFor(gross, rates, covered)` (BR-57).**
  - The employee pays 0.75% and the employer 3.25% of the month's gross, rounded up to the rupee.
  - A person is covered when their gross at the start of a contribution period (April to September, October to March) is ₹21,000 or less, and stays covered to its end.
- **`ptFor(gross, state, month, gender, rates)` (BR-57).** By the state's monthly slabs, including Maharashtra's ₹300 in February and its slab for women. Madhya Pradesh uses its annual slabs spread by month.
- **`lwfFor(state, month, rates)` (BR-57).** The employee and employer amounts in the months the state collects them.
- **`tdsFor(…)` (BR-58), new regime only.** Annual taxable income is projected as:
  - what this financial year has already paid;
  - plus this month;
  - plus the structure's gross for the months left;
  - less the standard deduction.

  The function then applies the slabs, the section 87A rebate with its marginal relief, and 4% cess. Of the annual tax, the part not yet deducted is spread evenly over the months left, this one included.
- **Out of v1, flagged on the payslip for manual handling rather than computed:**
  - surcharge, above ₹50 lakh;
  - TDS for someone without a PAN on file (section 206AA);
  - a person's other income or a previous employer's salary.

### Rates as dated configuration

- A `StatutoryRateSet` (zod, `packages/shared/src/schemas/statutory.ts`) holds PF, ESI, PT slabs by state, LWF by state and TDS slabs, in force from a date.
- The vendor keeps rate sets in the directory (`directory.statutory_rate_sets`), on the console's Payroll rates page (`platform.settings.manage`).
- Cells read them through a `StatutoryRates` seam, as billing reads its settings.
- Rate sets are only ever added; a payslip keeps the ID of the set it used.
- The first set, from 2026-04-01, is checked figure by figure against the official sources at build time: EPFO, ESIC, each state's PT and LWF notifications, and the Income-tax Act as amended by the Finance Act 2026. The sources are cited in `docs/payroll/statutory-rates.md`.

### Advisor review

- The vendor records a review with the reviewer's name and date: `directory.statutory_reviews`, on the console. It covers one rate set and the rules' version.
- Until a review covers the rules' current version and the rate set in use, the portal, the phone and each payslip carry the words "Awaiting review by a chartered accountant" (`payroll.awaiting_review`).

### Module

- `statutory_payroll` is a switchable module (D125) and an add-on in the plans, off by default.
- Its permissions:
  - `payroll.run`: run and approve the month. Admins only.
  - `salary.manage`: structures and statutory profiles. Admins.
  - `payslip.view`: already exists; people see their own payslips.
- B4's provisional estimate stays for tenants without the module. With the module on, the person's payslip is the statutory one.

### Tables

All have RLS, keys led by `tenant_id`, and cross-tenant fixtures.

- **`cell.salary_structures`:** `(tenant_id, user_id, from_period, basic, da, retaining, hra, conveyance, special, other jsonb)`. Changes are dated as gross is (D117).
- **`cell.statutory_profiles`:** `(tenant_id, user_id, work_state, gender_for_pt, pf_member, pf_full_wage, uan, esi_number, pan_on_file boolean)`.
  - The PAN itself is never stored; payslips show "PAN on file".
  - UAN and the ESI number are personal data: in the data export and erased with the person.
- **`cell.pay_runs`:** `(tenant_id, id, period, status draft|approved, rate_set_id, rules_version, approved_by, approved_at)`.
- **`cell.payslips`:** `(tenant_id, pay_run_id, user_id, …)`. Each holds the days, every earning and deduction line, the employer contributions, the totals and its flags. It is written as a draft and frozen on approval. A frozen payslip never changes; a correction is an adjustment line in a later run (`cell.pay_adjustments`, earning or deduction, with a note).

### Routes

- `GET`/`PUT /v1/salary-structures/{userId}` and `/v1/statutory-profiles/{userId}` (`salary.manage`).
- `POST /v1/pay-runs` (draft a month), `GET /v1/pay-runs/{period}`, `POST /v1/pay-runs/{period}/recompute` and `/approve` (`payroll.run`).
- `GET /v1/payslips/{userId}/{period}`, which also serves the person's own, as today.
- Every write is idempotent and audited. Audit entries never hold an amount, as with D117.

### Reports, imports and API

- A `pay_register` report: one row a person, with the earnings, every deduction and the employer contributions. It is in the statutory payroll module and needs `payroll.run`.
- A `salary_structures` import and its bulk route.

### Portal

- **Payroll:**
  - The month's run: draft, recompute, approve with a confirmation.
  - The register beside the run.
  - Each payslip printable (D99): the statutory layout with the tenant's legal name, PF and ESI numbers, days, earnings, deductions, net pay in words, and the review label until reviewed.
- **On a person's page:** their salary structure and statutory profile.
- **Console:** Payroll rates and the review record.

### Phone

- My pay shows the frozen payslip for each approved month, read online.
- The estimate stays for tenants without the module.

### Words

English and Hindi. Net pay in words through `@thelamp/i18n` in both languages, in the Indian system (lakh, crore).

## Review focus

1. **Ceilings and coverage.** PF wage above, at and below ₹15,000, with and without the full-wage option. ESI coverage at ₹21,000 and ₹21,001. A rise in pay within a contribution period keeps the person covered. Fixtures FX-59 to FX-62.
2. **The 50% rule.** A structure with HRA and allowances above half the total moves the excess into PF wages. FX-63.
3. **State specifics.**
   - Maharashtra in February and its slab for women.
   - Karnataka's threshold.
   - Madhya Pradesh's annual spread.
   - LWF only in its months.
   - A person with no work state gets no PT, and the payslip flags it.
   - FX-64 to FX-66.
4. **TDS across the year.** A person joining in October. A raise in January. Income at the 87A threshold and just above it, with marginal relief. FX-67 to FX-69.
5. **Freezing.**
   - An approved run never changes; recomputing it is refused.
   - A rate set added later doesn't touch it.
   - An adjustment lands in the next run.

   Tested.

---

### Pull request 1: the rules and the server

- [x] The rules and fixtures FX-59 to FX-69, each worked by hand in the test's comment. Rate set schema and the 2026-04-01 reference set, checked against sources and cited.
- [x] The module and permissions in every template. Tables and migrations. The `StatutoryRates` seam with the directory's rate sets and reviews. Salary structures, statutory profiles, pay runs, payslips and adjustments.
- [x] Routes, the import (the bulk route waits until an API client needs it), the `pay_register` report. The data export's personal columns and erasure. `pnpm openapi`. Cross-tenant fixtures.
- [x] Tests:
  - unit;
  - integration: a run end to end for five people across states, regimes and ceilings, against figures worked by hand; freezing; adjustments; the module off; scope; the review label.

### Pull request 2: the portal and the console

- [x] The Payroll page with the run and register, the statutory payslip for print, structures and profiles on a person's page, and the console's Payroll rates and review.
- [x] Vitest and Playwright with axe.

### Pull request 3: the phone and the demo

- [ ] My pay with frozen payslips. The demo switches the module on for one demo tenant, with structures and an approved last month.
- [ ] Tests: Jest, demo content.
- [ ] Decision D128, spec M14 and BR-56 to BR-58, `CLAUDE.md`, `docs/security/data-classification.md` (UAN, ESI number, pay), the store answers (payslips on the phone), the privacy notice, progress and tracker. `pnpm verify` before each merge, with the local services stopped.
