# Stage M6: month, attendance, leave, claims and More — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The phone's remaining screens read as the prototype's `AppMonth`, `AppAttendance`, `AppLeave`, `AppClaim` and `AppMore`:
- **My month:** "October · updated 2:30 pm", a score ring on Forest with the rank and its movement, the tiles two across, and the leaderboard with numbered rows, territory, score and a tinted "you".
- **Attendance:** the month grid in a card with today ringed, the legend as badges with counts, and "Leave left this year".
- **Leave:** types as tinted cards with what is left, "Who decides" before sending, and Send held at the foot.
- **Claims:** receipts, right-aligned amounts, flags and the month's total; "After you send it" on a new claim.
- **More:** a profile card, the upload queue inline, My work rows with live values, language and look as segments, and "Synced …" at the foot.

**Architecture:** One API addition: `POST /v1/approvals/preview` (`{ requestType, facts }`) answers who would decide such a request from the caller, routed by `ApprovalsService` exactly as `request()` would, without writing. Everything else is the phone's. `@thelamp/ui-mobile` gains `ScoreRing` and `ChoiceCard`, mirrored to the design system. `Steps` (M1) draws both chains.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage M6; the prototype's five artboards; decisions D57, D80, D81, D83 for behaviour.

## Global constraints

- Out of scope, as D104 lists them:
  - "Started" and "Finished" on a fixed day (`CreateRegularisationBody` has no times);
  - monthly claims, where the prototype shows one draft a month (the product claims each expense);
  - "Send back".
- The preview routes as the caller with the facts given, using `REQUEST_FACTS` keys:
  - leave: `leave_days`, `paid`;
  - expense: `amount`, `over_policy`.

  Steps a condition skips don't show. Without a chain it is the manager, as D38 routes. Vendor support and API clients have no user to route from, so they are refused with `FORBIDDEN`.
- The score ring is drawn on `brand-forest` with `brand-gold`. Those are the product's own (D72), and so is the panel, as on sign-in. Its value is 0 to 100; with no score it says "Not ranked".
- Rank movement compares `rank` with `previousRank`: up, down or the same. It says nothing without a previous rank.
- Language and look become `SegmentedControl`s. Look keeps System as its first segment.
- My work's trailing values:
  - Attendance: days to fix this month.
  - Leave: the days left across paid types.
  - Claims: the month's claims waiting, as an amount.
  - Leaderboard: the rank.

  Each value shows only once its data is on the phone.

## Review focus

1. **No score or rank.** The ring says "Not ranked" and there is no movement; the leaderboard still lists. Tested.
2. **No chain and no manager.** The preview says nobody can approve yet, and Send still works (the server decides). Tested.
3. **Leave types without quotas.** A card without a balance says nothing of what is left. Tested.
4. **Nothing waiting to upload.** More says everything is sent, with no list. Tested.
5. **Hindi at 390 px.** The ring's panel, three type cards across, the legend badges and the segments fit. Checked in the browser.

---

### Task 1: who would decide

- `packages/shared/src/schemas/approvals.ts`:
  - `ApprovalPreviewBody` (`requestType`, `facts: record`);
  - `ApprovalPreviewResult` (`steps: { approvers: Person[], escalated, fallback }[]`, or `blocked: true` when nobody can approve).
- `ApprovalsService.preview()` shares the routing of `request()` (one private `route()`).
- `ApprovalsController`: `POST /v1/approvals/preview`, `@SignedIn()`, with its `@Contract`.
- A cross-tenant fixture, then `pnpm openapi`.
- [x] Tests (integration): a leave preview names the manager; with a chain, its steps and a skipped condition; an API client is refused.

### Task 2: the parts

- `ScoreRing` (`value`, `label`), an SVG ring, 88 px.
- `ChoiceCard`: a tinted card that is a radio, with a label and a line under it, and the chosen one ringed in `accent`.
- Each in PhoneParts, README and preview, mirrored to the artifact.
- [x] Tests: the ring's name and value; the card's checked state and press.

### Task 3: My month

- `MonthScreen`:
  - an `AppBar` with the month and "Updated …";
  - the Forest panel with the `ScoreRing`, "Rank #n of m" and its movement;
  - the tiles two across;
  - the leaderboard of the person's group (`useLeaderboard`), with a `SeqBadge`, the name, territory and score, and the person's row highlighted.
- [x] Tests: the ring, rank and movement; not ranked; the "you" row.

### Task 4: Attendance

- An `AppBar` with the month; the month switch as it is today.
- The grid in a `Card` with today ringed.
- The legend as `StatusBadge`s with counts, then the day card as today.
- "Leave left this year": the first three paid types' balances and Apply, when the leave module is on.
- [x] Tests: counts in the legend; the leave card and its absence with the module off.

### Task 5: Leave

- `NewLeaveScreen`:
  - an `AppBar`;
  - the types as `ChoiceCard`s with "n left";
  - "Who decides" as `Steps` from the preview: You ask, then each approver;
  - Send in an `ActionBar` at the foot.
- `LeaveScreen` gets an `AppBar` and Apply.
- [x] Tests: a card per type with what is left; the preview's steps; Send at the foot.

### Task 6: Claims

- `ExpensesScreen`:
  - an `AppBar`;
  - the month's total in a card;
  - rows with a receipt `PhotoTile` (48), the description and date, `Flag`s for what was flagged, and the amount at the end.
- `NewClaimScreen`: "After you send it" as `Steps` from the preview, and Send in the footer.
- [x] Tests: the total; a flagged row; the preview.

### Task 7: More

- `MeScreen`:
  - a profile card (`Avatar` lg, name, "designation · territory · organisation");
  - the upload queue inline (up to three, with "Send now" and the way to all);
  - My work with trailing values;
  - Language and Look as `SegmentedControl`s;
  - sign-out as today;
  - "version · Synced …" at the foot.
- [x] Tests: the queue inline and empty; trailing values; the segments change language and look.

### Task 8: finish

- [x] Phone pairs in `tools/ui-compare` (month, attendance, leave, claim, more) with a fresh fixtures person; Hindi at 390 px; the gallery; the progress row; the pull request and `pnpm verify`.
