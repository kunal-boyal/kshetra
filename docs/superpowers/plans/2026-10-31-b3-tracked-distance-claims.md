# Phase 4 step B3: travel claims from tracked distance — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a per-km claim may be paid on the day's tracked distance instead of odometer readings (spec M12: "Travel claims calculated from tracked shift distance are a version 2 option"). Whatever pays, the claim shows the tracked kilometres beside the odometer's where both exist, and the approver sees a flag when they differ by more than the tolerance (D109).

**Architecture:**
- **A setting on per-km policies:** `kmFrom` is `odometer` (the default, as today) or `tracked`. It is versioned with the policy like every other policy setting, so a claim keeps the source in force on its day.
- **The day's tracked distance** is the sum of `shifts.distance_m` over the claimant's ended shifts that started on the expense date, on the tenant's clock. The field module answers it through `TrailsService.dayDistance()`, which first measures any ended shift whose trail isn't compacted yet, so a claim made right after punch-out doesn't wait for the outbox.
- **The claim keeps what it was judged on:** `expense_claims.tracked_km` (numeric(10,2), null when the day has no ended shift). Later points don't change a claim already made.
- **The gap flag:** `distance_gap` when a claim has both odometer and tracked kilometres and they differ by more than the tolerance. It applies under both sources; it flags the claim and never blocks it.
- **Late points:** when points arrive for a shift whose trail was already compacted, the ingest clears `compacted_at`, so the nightly job measures the shift again. Reports stay right, and claims keep their figure.

**Spec:** M12, BR-29; D83, D99, D109.

## Global constraints

- **Rules** (pure, `packages/shared/src/expenses.ts`):
  - `trackedKm(distanceM: number): string`: kilometres to 2 places, half up (BR-29's rounding).
  - `claimBase()` takes `kmFrom` and `trackedKm`: under `tracked`, per km pays `trackedKm × rate`; under `odometer`, it pays as today.
  - `claimIssues()`, under `tracked`:
    - readings aren't needed; if both are given, closing must not be below opening;
    - a day without an ended shift is refused with `tracked_needed` on `expenseDate`;
    - the odometer photo rule still applies when the policy asks for it.
  - `distanceGap(odometerKm, trackedKm): boolean`: true when the difference is more than `DISTANCE_GAP` (10% of the larger figure, and at least 2 km).
  - `expensePolicyIssues()`: `kmFrom` only on `per_km` policies.
- **Server:** `ExpenseClaimsService.create()`, for a per-km policy, reads `TrailsService.dayDistance(tx, access, date, timezone)` (always, for the flag), stores `tracked_km` and adds `distance_gap` to `flags` when it applies. A claim under `tracked` for a day whose shift is still open answers `VALIDATION` with "End the day's shift before claiming its tracked distance".
- **Answers:** `ExpenseClaimResult.trackedKm` (string or null); `ExpensePolicy.kmFrom` (default `odometer`, so templates and stored policies need no change). Run `pnpm openapi` and the templates schema.
- **Portal:**
  - Settings › Expense policies: a per-km policy shows "Kilometres from: Odometer readings / Tracked distance".
  - The claims list and the claim's detail show "Tracked km" beside the odometer readings, and the flag "Tracked and odometer kilometres differ".
- **Phone:**
  - the new-claim screen, under a tracked policy, shows the day's tracked kilometres from the person's own shifts (`GET /v1/shifts`, online) and previews the amount. Offline, or before the distance is measured, it says the server works it out when the claim is sent, as it does for per-visit claims.
  - Readings stay optional there.
  - A tracked claim waits in the outbox while the day's punch-out or points are still on the phone.
- **Words:** English and Hindi.

## Review focus

1. **A claim right after punch-out**, before the outbox has compacted the trail: the distance is measured on the spot. Tested.
2. **Two shifts in one day:** their distances add up. Tested.
3. **No tracking at all** (an odometer policy whose shift sent no points): tracked km is 0, and the gap flag is raised against the readings. Tested.
4. **A policy switched from odometer to tracked from a day:** claims before that day keep paying on readings. Tested.
5. **Points arriving after a claim:** the claim keeps its kilometres; the shift is measured again that night. Tested (the clearing of `compacted_at`).

---

### Task 1: the rules and the table

- `trackedKm`, `distanceGap`, `DISTANCE_GAP`, `kmFrom` in `claimBase` and `claimIssues`, and the policy check, with tests.
- `ExpensePolicy.kmFrom`; `expense_claims.tracked_km` and its migration.
- [x] Tests (unit): each rule, including the rounding and both ends of the tolerance.

### Task 2: the API

- `TrailsService.dayDistance()`, exported by the field module; the ingest clears `compacted_at` for late points.
- `ExpenseClaimsService.create()` and the result's `trackedKm`; `pnpm openapi`.
- [x] Tests (integration): a tracked claim paid on the day's two shifts; refused while a shift is open, and on a day without shifts; the gap flag under an odometer policy; measured right after punch-out; a policy version from a day; late points reopen the trail.

### Task 3: the portal

- The policy field; tracked km and the flag on claims.
- [x] Tests (Vitest and Playwright with axe).

### Task 4: the phone

- The new-claim screen under a tracked policy; the outbox wait; tracked km on the person's claims.
- [x] Tests (Jest): the preview from the day's shifts, the offline wording, and the wait.

### Task 5: finish

- [ ] Decision D115, spec M12 and BR-29, `CLAUDE.md`'s Expenses section, the progress row and tracker; `pnpm verify` before the merge.
