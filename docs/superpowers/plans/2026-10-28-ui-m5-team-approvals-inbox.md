# Stage M5: team, approvals and notifications — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The phone's Team, Approvals and Notifications read as the prototype's `AppTeam`, `AppApprovals` and `AppInbox`:
- **Team:** a header with how many people and an "Approvals · n" button; Review and On duty as segments with counts; review cards with the person, place and time, two photos, flags and an inline Approve; the auto-approval footnote.
- **Approvals:** a screen of its own, with type chips and their counts, and cards with the kind, how long ago, the requester, what it is, the requester's words, where it stands in its chain, and inline Reject and Approve.
- **Notifications:** grouped Today and Earlier, each with a hued category chip, unread marked by a dot and a tint, Mark all read in the bar, and the quiet-hours notice.

**Architecture:** One API addition: `ApprovalSubject.detail`, the requester's own words where the request has some, written by each type's `subjects()`. Everything else is the phone's: `TeamScreen` is redrawn, `/approvals` is a new screen beside `/approvals/<id>`, and `NotificationsScreen` gets its groups and bar. No new design-system part: the cards are made of `Card`, `Avatar`, `PhotoTile`, `Flag`, `StatusBadge` and `Button`, as `ReviewCard` and `ApprovalSteps` describe them.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage M5; the prototype's `AppTeam.dc.html`, `AppApprovals.dc.html` and `AppInbox.dc.html`; decisions D52, D76 and D59 for behaviour.

## Global constraints

- "Send back" stays out (D104: it needs a submission state of its own); the review card offers Open and Approve, and rejecting still asks for a reason on the item's screen.
- The prototype's "Plans · 2" segment stays out. Months of plans waiting for a decision are approval requests, so they appear in Approvals.
- Approve is inline only where the generic decision works. A request decided on its own page (`page`, such as an order over credit) offers Open instead. Reject always opens the request's screen, which asks why (`NOTE_MIN`).
- `detail` is the requester's words, never server-written prose, so it needs no translation:
  - leave: its reason;
  - a fixed day: its reason;
  - an order: its note;
  - everything else: null.
- "Step n of m" counts the chain's steps. "You decide" is shown when the waiting step is the caller's and it is the last.
- Times read relative within a day ("20 min ago", "3 h ago"), then as the date. Notifications are grouped by the tenant's today.
- The quiet-hours notice shows the tenant's `quietHoursStart` and `quietHoursEnd`.

## Review focus

1. **Nothing waiting.** Team's Review segment shows its empty state; Approvals says nothing waits; Notifications says it's empty. Tested.
2. **A request decided on its own page.** No inline Approve; Open instead. Tested.
3. **Approve fails** (another approver got there first). The error shows on the card. Tested.
4. **A manager without review or live map.** The segments show only what they may see; with one, there are no segments. Tested.
5. **Hindi at 390 px.** Segments with counts, type chips and the card actions fit. Checked in the browser.

---

### Task 1: the approval's detail

- `packages/shared/src/schemas/approvals.ts`: `ApprovalSubject` gains `detail: z.string().nullable()`.
- Each `subjects()` fills it:
  - `leave-requests.service.ts` (reason);
  - `regularisations.service.ts` (reason);
  - `orders.service.ts` (note);
  - the rest `null`, including `AccountsService.subjects()`.
- `pnpm openapi`.
- [x] Tests: the inbox's leave and order items carry their words; a proposal's is null (integration, `approvals` tests).

### Task 2: Team

- `TeamScreen`:
  - the header (`team.title`, "n people" from the people the phone keeps, an "Approvals · n" tonal button to `/approvals` for approvers);
  - a `SegmentedControl` of Review · n and On duty · n by permission;
  - `ReviewCard` rows: `Avatar`, "person · form", "account · time", up to two `PhotoTile`s from `usePhotoLink`, `Flag`s, Open and Approve;
  - the footnote from the queue's auto-approval rules.
- On duty keeps today's map and list.
- [x] Tests: the segments by permission; a card approves inline and leaves; Open goes to the item; the footnote; the empty review.

### Task 3: Approvals

- `/approvals` (`src/app/(app)/approvals/index.tsx`, `ApprovalsScreen`):
  - an `AppBar` back to Team;
  - a `ChipGroup` of All · n and each waiting type with its count, filtering on the server (`requestType`);
  - cards with a `StatusBadge` of the type, the relative time, `Avatar`, "requester · title", `detail`, the step line, and Reject (opens `/approvals/<id>`) and Approve (inline) or Open.
- [x] Tests: chips and counts; approve inline; a page-decided request offers Open; a failed approval says why; nothing waiting.

### Task 4: Notifications

- `NotificationsScreen`:
  - an `AppBar` back with Mark all read while any is unread;
  - Today and Earlier groups;
  - rows with an `IconChip` hued by category, the title and body, the time, `unread` and `highlight`;
  - the quiet-hours `Notice`;
  - the preferences below as today.
- [x] Tests: the groups; mark all read; the notice's hours; the empty inbox.

### Task 5: finish

- [x] Phone pairs in `tools/ui-compare` (Team, Approvals, Notifications) with a fresh fixtures manager; Hindi at 390 px; the gallery; the progress row; the pull request and `pnpm verify`.
