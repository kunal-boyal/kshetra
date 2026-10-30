# Quarter and year targets — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a tenant can set targets and score people by the quarter or the year of its financial year, as spec 5.8 allows ("month by default; quarter or year when the tenant enables them"). Kunal chose the financial year on 2026-10-30 (D107).

**Architecture:**
- The score definition's `periodType` already exists, and `MetricsAdmin` refuses anything but `month`. It becomes the tenant's one target period:
  - `month` by default;
  - `quarter` or `year`, counted from `financialYearStartMonth` (default April).
- A period key names its days; a pure function in `@thelamp/shared` turns a key into its first and last date. `PerformanceService`, `TargetsService` and the rank cutoff read the dates from it instead of `monthDates()`.
- Daily facts stay as they are, so a quarter sums its three months' days.
- Account plans, journey plans, attendance and expenses stay monthly.

**Spec:** 5.8, 10.3 (targets), BR-06 to BR-08, Appendix B.4 (the targets import); decisions D55, D56, D65.

## Global constraints

- **Period keys** (`TargetPeriod` in `packages/shared/src/schemas/planning.ts`; `Period` stays the month for everything else):
  - a month: `2026-10`;
  - a quarter: `FY2026-Q3`, the third quarter of the financial year that starts in 2026, which is Oct–Dec 2026 with an April start;
  - a year: `FY2026`, Apr 2026 to Mar 2027.
- **Labels** come from `formatPeriod()` in `@thelamp/i18n`, in English and Hindi:
  - "October 2026";
  - "Q3 2026–27 (Oct–Dec)";
  - "2026–27".
  With a January start, a year reads "2026".
- **The tenant's period:**
  - `targetPeriodOf(settings, score)` says which kind applies;
  - `periodOf(kind, day, startMonth)` gives the key a day falls in;
  - `periodDates(key, startMonth)` gives its first and last date;
  - `previousPeriod(key)` gives the period before, for copying.
- **Changing the kind** (month to quarter, say) takes effect from the next period that starts after the change:
  - target sets and snapshots already made keep their keys;
  - the score definition gains `periodFrom`, the first key of the new kind, and is refused if that key has already begun.
- **Movement "since last week"** works for every kind: `rankCutoff()` takes the period's dates.
- **Imports (B.4):** the period column takes the tenant's kind of key, and the month name for months. A key of another kind is refused, giving the kind expected.

## Review focus

1. **A quarter that has begun.** Switching to quarters in the middle of Oct–Dec starts at the next quarter. October stays a month with its own targets. Tested.
2. **A financial year starting in January.** Quarters fall on the calendar's quarters and the year reads "2026". Tested.
3. **Copying from the period before a switch.** The first quarter after months has nothing of its kind to copy, so it says so. Tested.
4. **Leap years and month ends.** Q4 of an April year ends on 31 March, and February is never counted twice. Tested with Appendix D-style fixtures.
5. **Hindi at 390 px.** "Q3 2026–27 (Oct–Dec)" fits the phone's bar and the portal's month stepper, which becomes a period stepper. Checked in the browser.

---

### Task 1: periods (shared)

- `packages/shared/src/periods.ts`:
  - `TargetPeriodKind`;
  - `periodOf()`, `periodDates()`, `previousPeriod()`, `nextPeriod()`, `periodKind()`;
  - `targetPeriodOf()`.
- `TargetPeriod` schema.
- `rankCutoff()` takes dates.
- The month-only `shiftPeriod()` in `avatars.ts` gives way to the one in `periods.ts`.
- `formatPeriod()` in `@thelamp/i18n`.
- [x] Tests: every kind, both start months, the year boundary, February, keys refused.

### Task 2: the server

- `MetricsAdmin`:
  - accepts `quarter` and `year` with `periodFrom`;
  - refuses a `periodFrom` that has begun or isn't of the kind.
- `TargetsService`:
  - lists, saves, locks, copies and imports by `TargetPeriod`;
  - refuses a key of the wrong kind for its date (`VALIDATION_FAILED` on `period`).
- `PerformanceService` and the snapshot job read the period's dates. The dashboard, `/v1/performance/*` and the leaderboard take `TargetPeriod`.
- The current period comes from the config bundle's `targetPeriods` (`periodType`, `periodFrom`, `earlierPeriodType`), with `financialYearStartMonth` from its settings; the bundle's shape becomes 7.
- `pnpm openapi`; cross-tenant fixtures unchanged (same routes).
- Frequency norms (visits a month) are multiplied by the period's months.
- The lock notification names the period in each language; `target.locked` events take any key.
- [x] Tests (integration): a quarter's targets lock and score from three months of facts; a switch takes effect only from a quarter to come, and choosing months again calls it off; the import takes `FY2029-Q4` and refuses a month for a quarterly tenant; copying only from a period of the same kind. Movement within a quarter is a unit test of `rankCutoff()`.

### Task 3: the portal

- Settings › Metrics: the score's period as a segmented choice (Month, Quarter, Year) with "From …", which shows the next period's label.
- Targets, Performance and Home use a period stepper (`PeriodStepper` in `apps/web/src/performance/shared.tsx`) in place of the month stepper, labelled with `formatPeriod()`.
- [ ] Tests (Vitest and Playwright with axe): the setting; the stepper moves by quarter; a copy that has nothing to copy says so.

### Task 4: the phone

- My month becomes My period: the bar says "Q3 2026–27" or the month, from the bundle's kind; the ring, tiles and leaderboard read the same routes with the period key.
- [ ] Tests (Jest): the label by kind; the screen asks for the quarter's key.

### Task 5: finish

- [ ] Template schema: `score.periodType` stays additive, and templates keep `month`.
- [ ] Decision D108 and the progress row; the open item on quarters closes.
- [ ] Pull requests: 1, the shared rules and the server (tasks 1 and 2); 2, the portal and the phone (tasks 3 and 4). `pnpm verify` before each merge.
