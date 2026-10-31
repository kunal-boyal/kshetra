# Phase 4 step B2: leave accrual and carry-forward — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a leave type can credit its quota monthly instead of all at once, and carry unused days into the next quota year up to a cap; anything over the cap lapses when the year ends (spec 5.10: "Accrual and carry-forward arrive in version 2"). Balances show what was credited, carried in, taken and lapsed (D109).

**Architecture:**
- **Two settings on `LeaveType`, defaults unchanged:** `accrual` (`yearly`, the whole quota on the year's first day as today, or `monthly`) and `carryForwardMax` (days, 0 as today). No template switches either on (D109's recommendation), so nothing changes until a tenant sets them.
- **Credits are worked out, never stored:** `leaveCredited()` gives the days credited by a date, from the type and the person's joining date.
- **Year ends are stored:** carrying needs last year's figures, so each quota year that ends is closed into `cell.leave_year_closings` (credited, carried in, taken, carried out, lapsed and the cap used). A closed year doesn't change when the type's settings later change. A decision that changes a closed year (late approval, cancellation) closes it and the years after it again, each with its own recorded cap.
- **The quota check allows what is credited by the request's start date, plus what was carried in,** instead of the whole year's quota.

**Spec:** 5.10, M13, BR-27; D81, D109.

## Global constraints

- **Rules** (pure, `packages/shared/src/leave.ts`):
  - `leaveCredited(type, year, day, joiningDate)`:
    - `yearly` gives `annualQuota`;
    - `monthly` gives `floor(annualQuota × months ÷ months in the year × 2) ÷ 2`: whole half days, rounded down, so twelve months give exactly the quota;
    - months count from the year's first month, or the joining month if later, through the month of `day`.
  - `closeLeaveYear({ credited, carriedIn, taken, cap })` returns:
    - `carriedOut = min(cap, max(0, credited + carriedIn − taken))`;
    - `lapsed` = what is left after that.
  - `leaveBalance()` adds `credited`, `carriedIn` and `lapsed`; `available = credited + carriedIn − approved − pending`, never below 0.
  - `leaveIssues()` takes `allowance` (credited by the start date + carried in) in place of the year's quota for its `quota` issue.
- **Types without a quota** (0) don't accrue, carry or lapse, as today.
- **Days** are numbers of half days, as `leave_requests.days` already is; the table keeps them as `numeric(6,1)`.
- **Closing:**
  - the nightly job `leave.close_years` (`atTenantTime('00:40')`) closes, for each type with `carryForwardMax > 0`, each active person's quota year that ended yesterday or before and has no closing yet;
  - it is idempotent: one row per person, type and year;
  - it is audited once per run as `leave.years_closed` with counts, as `retention.applied` is;
  - types without carry-forward need no closing; their lapsed days are worked out when read.
- **Re-closing:** `decided()` and cancelling, for a request starting in a closed year, close that year and the years after it again in the same transaction.
- **Balances** (`GET /v1/leave-balances`) add `credited`, `carriedIn` and `lapsed`; lapsed is 0 until the year ends.
- **Words:** English and Hindi.

## Review focus

1. **A twelve-day monthly type over a year:** credits 1, 2, … 12; an eighteen-day type credits whole half days and ends on 18. Tested.
2. **A person joining in September** on a monthly calendar-year type: credited from September only. Tested.
3. **A request in a closed year approved late:** the year's closing and the next year's carried-in change, and the cap recorded at closing still applies. Tested.
4. **A cap lowered after a year closed:** the closed year keeps its carry; the next closing uses the new cap. Tested.
5. **A type with neither setting:** balances, issues and the phone's preview are exactly as before. The existing tests pass unchanged.

---

### Task 1: the rules and the table

- `leaveCredited`, `closeLeaveYear`, the wider `leaveBalance`, `allowance` in `leaveIssues`, with tests.
- `LeaveType.accrual` (default `yearly`) and `carryForwardMax` (default 0, 0 to 366 in half days), with the template schema regenerated.
- `cell.leave_year_closings`, with `tenant_id`, RLS, the key `(tenant_id, user_id, leave_type_key, year_from)` and the migration.
- [x] Tests (unit): each rule above.

### Task 2: the API

- `LeaveRequestsService`:
  - `create()` checks against the allowance;
  - `balances()` adds the new figures;
  - `closeYears()` runs nightly, and `reclose()` runs from `decided()` and cancellation.
- The cross-tenant fixture for the closings (read through balances), and `pnpm openapi`.
- [x] Tests (integration): monthly credits through the year; a joiner; closing carries up to the cap and lapses the rest; running it twice changes nothing; a late approval re-closes; a lowered cap; a request over the allowance refused with `QUOTA_EXCEEDED`.

### Task 3: the portal

- Settings › Leave types: Accrual (all at once, or monthly) and Carry forward up to N days.
- A person's leave: balance columns Credited, Carried in, Taken, Waiting, Available and Lapsed.
- [x] Tests (Vitest and Playwright with axe).

### Task 4: the phone (pull request 2)

- Leave balances show credited and carried in.
- `previewLeave()` judges against the kept balance's allowance less the queued requests.
- [ ] Tests (Jest).

### Task 5: finish

- [ ] Decision D114, spec 5.10, `CLAUDE.md`, the progress row and tracker; `pnpm verify` before each merge.
