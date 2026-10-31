# Phase 4 step B4: payroll inputs — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the optional Payroll inputs module (spec M14, D14):
- each person's monthly gross, entered or imported;
- provisional pay per BR-26, worked out from attendance;
- a payslip preview printed through the browser (D99), labelled an attendance-based estimate;
- the month's attendance summary as an export for payroll providers.

There are no statutory deductions (PF, ESI, PT, TDS) and no integrations.

**Architecture:**
- **A new `payroll` module** in `apps/api/src/modules/payroll`, behind the `payroll_inputs` module switch. Its permissions already exist: `payroll.manage` for back office and `payslip.view` for one's own estimate. It reads days only through `AttendanceService.days()` and people through `People`.
- **Gross by month:** `cell.payroll_gross` keeps each change with the month it applies from. A month's pay uses the gross in force that month, so a raise never rewrites months already paid.
- **Pay is worked out, never stored:** `provisionalPay()` in `packages/shared/src/payroll.ts` applies BR-26 to a month of days.
- **The summary is a report**, `payroll_summary`: one row per person for the month. It goes through the existing export pipeline and joins the workbook on its own (D112).

**Spec:** M14, BR-24 to BR-26, 8.4 (provisional pay copy), Appendix B.7 (payroll gross import); D14, D99, D109.

## Global constraints

- **Rules** (pure, `packages/shared/src/payroll.ts`):
  - `provisionalPay(gross, days)` applies BR-26 to one month: `round(gross × min(paid, scheduled) ÷ scheduled, 2)`, and 0 when nothing is scheduled. It returns `{ scheduled, paid, amount }`. Scheduled days are the month's calendar working days (each day's `working`), employed or not, future or not (D117); paid days count the days so far. The service marks the current month `toDate`.
  - `grossOn(changes, period)` finds the gross in force for a month: the latest change from that month or before.
  - Money is exact as paise through `scaled()` and `unscaled()`. The FX-17 and FX-18 fixtures pass.
- **Table:** `cell.payroll_gross(tenant_id, user_id, from_period 'YYYY-MM', monthly_gross numeric(18,2), updated_by, updated_at)`, with key `(tenant_id, user_id, from_period)`, RLS, and a cross-tenant fixture. Gross is personal data:
  - erasure removes it (`PayrollService.erasePerson()`, added to the data request erasure);
  - it goes into the personal archive on its own, and into `docs/security/data-classification.md`;
  - audit entries record that it changed, never the figure.
- **Routes** (all `@InModule('payroll_inputs')`):
  - `PUT /v1/payroll-gross/{userId}` (`payroll.manage`, scope): `{ monthlyGross, from }`, where `from` is this month when left out and never earlier than the person's latest change.
  - `GET /v1/payroll?period=` (`payroll.manage`): one row per person in scope, with gross, scheduled, paid, provisional pay and whether it runs to date. Paged.
  - `GET /v1/payslips/{userId}/{period}` (`payroll.manage` for anyone in scope; `payslip.view` for oneself): the payslip preview's data, with the day counts by status.
- **Import:** a `payroll_gross` import target, with the columns Employee code*, Monthly gross* and From month (this month when blank). It provides `example()` (D111).
- **Report:** `payroll_summary`, with `REPORT_MODULE` set to `payroll_inputs` and `REPORT_PERMISSION` set to `payroll.manage`. Its columns are code, name, designation, gross, scheduled days, present, half days, paid leave, unpaid leave, absent, holidays and weekly offs, paid days, and provisional pay.
- **Portal (pull request 1):**
  - **Payroll in the rail** (`payroll.manage`): the month picker, a table of people with gross, paid ÷ scheduled days and the estimate, each row editable for gross, and Export.
  - **The payslip preview:** `Printable` with a `PrintButton`. It shows the tenant's legal name, the person, the month, gross, the day counts, the estimate, and the 8.4 copy: "Attendance-based estimate. This is not a statutory payroll document."
- **Phone (pull request 2):** "My pay estimate" under Me, for `payslip.view`, read online. It shows this month to date and last month, with the same words. The phone keeps nothing.
- **Words:** English and Hindi.
- **Also in pull request 1:** regional languages (E2) leave the phase 4 plan, as Kunal decided on 2026-10-31 (decision D116).

## Review focus

1. **A person who joins on the 20th:** the estimate is pay for the days they were employed, not the full gross. This is the joiner decision below. Tested.
2. **The current month:** labelled to date, and counting only the days so far. Tested.
3. **A raise applied from next month:** this month's and last month's estimates keep the old gross. Tested.
4. **A person without a gross:** listed with no estimate and a prompt to enter one; the payslip says so. Tested.
5. **Module off:** routes answer `MODULE_DISABLED`, the report closes, and the rail entry and the phone screen hide. Tested.

---

### Task 1: the rules and the table

- `provisionalPay`, `grossOn`, FX-17 and FX-18, with tests; the zod schemas in `packages/shared/src/schemas/payroll.ts`.
- `cell.payroll_gross` with its migration.
- [x] Tests (unit).

### Task 2: the API, the import and the report

- `PayrollService`, `PayrollController`, the `payroll_gross` import target, the `payroll_summary` report, erasure; `pnpm openapi`.
- [x] Tests (integration):
  - gross from a month;
  - a raise leaving past months alone;
  - a joiner's part month;
  - the current month to date;
  - one's own payslip but not another's;
  - scope;
  - module off;
  - the import and its example;
  - the report and the workbook;
  - erasure;
  - the cross-tenant fixtures.

### Task 3: the portal

- Payroll page, gross editing, the payslip preview with print, the rail entry, strings.
- [x] Tests (Vitest and Playwright with axe, the print layout included).

### Task 4: the phone (pull request 2)

- My pay estimate.
- [x] Tests (Jest).

### Task 5: finish

- [ ] Decisions D116 and D117, spec M14, `CLAUDE.md`, the progress row and tracker; `pnpm verify` before each merge.
