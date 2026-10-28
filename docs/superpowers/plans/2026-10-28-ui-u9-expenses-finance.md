# Stage U9: Expenses and finance — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expenses read as the prototype's `WebExpenses` (the month's totals as tiles, where each claim is, what the caps cut, the policies as cards), and an account's finance reads as `WebFinance` does for one account (outstanding and credit tiles with a usage meter, ageing as a bar, where the ledger came from and when).

**Architecture:** One API task (the claims list's totals), then the two screens.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage U9; the prototype's `WebExpenses.dc.html` and `WebFinance.dc.html`.

## Global constraints

- Money is summed in SQL as `numeric` and travels as decimal strings; the portal formats it with `formatMoney`. Bars may draw from `Number()` of an amount, never compute one.
- "Over the policy" is what the caps cut (BR-29): `calculated − amount` of capped claims. Claims are capped as they are made, so nothing over the policy is ever paid.
- "Where it is" comes from the claim's approval as the list already returns it: the current step's approvers and "step n of m", approved and waiting to be paid, paid on a day, or decided by whom.
- Nothing is lost: the status filter, Load more, receipts and flags, Mark paid with its reference, the statement, its printing and the back office's forms.
- Out of scope (feature decision 4): the tenant-wide "Outstanding and collections" page (it needs list and aggregate endpoints), collection targets and days to get paid.

## Review focus

1. **A month with no claims.** The tiles read zero and the table its empty state. Tested.
2. **A claim with no approval** (made before chains, or a type without one). "Where it is" says what its state says. Tested.
3. **An account without a credit limit, or over it.** No meter without a limit; over the limit, the tile is in the danger tone. Tested.
4. **No balance yet.** The finance section says so, with no tiles or bar. Tested.
5. **390 px.** Tiles stack, the table scrolls in its box. Checked in the browser.

---

### Task 1: the claims' totals (API)

- `ExpenseClaimListResult.summary: { claimed, claims, waiting, waitingClaims, overPolicy, approved, approvedClaims } | null` (bills are counted per claim in the table; the media module owns them), on the first page only, under the filters but `state`: everything but cancelled claims; pending ones; what the caps cut; approved and not yet paid.
- [x] Tests (`test/expenses.int.test.ts`): the totals after a capped claim, an approved one and a pending one; a cursor page has none.

### Task 2: the Expenses page

- Header "Expenses · October 2026", the intro as meta, Policy (`expense_policy.manage`, to Settings › Expense policies) and Export for payroll (the expense register export, then Reports); toolbar a `PeriodStepper` and status chips.
- Four `StatTile`s: Claimed (claims), Waiting for a decision (claims), Over the policy (cut by the caps, in the pending tone), Approved for payment (claims).
- Columns: Day, Person, Policy with the description under it, Bills with flags, Amount, Over policy, Where it is, Status (waiting, success, danger, neutral), Mark paid.
- Policy cards: each active policy's name and a line (rate, caps, bill needed).
- [x] Tests (`expenses.test.tsx`): the tiles; over policy and where it is for a pending, an approved and a paid claim; the policy cards; the period stepper asks again.

### Task 3: an account's finance

- Header line "Ledger from {source} · {when}".
- `StatTile`s: Outstanding (as of), Credit limit with the share used as a meter (danger over the limit; none without a limit), and the stock value when given.
- Ageing as a `StackedBar` in bucket order, toned from not due (success) to the oldest (danger), with its legend.
- [x] Tests (`accounts.test.tsx`): tiles, meter and its absence, the bar's legend, no balance.

### Task 4: finish

- [x] e2e mocks; `tools/ui-compare --only expenses,finance`; 390 px in Hindi; the gallery; the progress row; the pull request and `pnpm verify`.
