# Phase 4 step C2: anomaly flags on evidence — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** five new submission flags that point reviewers at evidence worth a second look. They never block anything (D109). Each flag:
- is explained in words on the review page;
- is a filter in the review queue;
- keeps a submission out of auto-approval, as every flag does;
- has a tenant switch, on by default.

**The five flags (decision D119, Kunal's answers of 2026-11-01):**

| Flag | When |
|---|---|
| `photo_far` | One of the record's photos was taken more than 150 m from the record's own fix. The 150 m is counted after allowing both fixes' accuracies, each capped at 100 m. Beyond 500 m the photo is refused already (BR-32). |
| `fast_travel` | The record and another record of the same person are at least 5 km apart (straight line), and closer in time than 100 km/h would take. |
| `burst` | Three or more of the person's records fall within 10 minutes, at three or more places. Two places differ when the records are at different accounts, or, without accounts, more than 300 m apart. |
| `off_shift` | Captured outside the person's shifts, on a form that allows off-shift capture. |
| `mock_history` | The person's phone refused a mocked fix in the 30 days before the capture, or one of the record's photos has a mocked fix of its own. |

"Another record" means one of the person's submissions, visit check-ins and check-outs, or punch-ins and punch-outs, as the server has them.

**Architecture:**
- **Rules:** pure functions in `packages/shared/src/anomalies.ts`, shared by the server and the review page's words.
- **The server judges at ingest.** `SubmissionsService.create()` reads the person's records within 12 hours either side of the capture and adds the flags in the creating transaction. A pair or burst found this way also flags the person's other submissions in it, while they wait for review (`array_append`, as `duplicate_photo` does now).
- **Explanations:** `submissions.flag_notes jsonb` keeps what each flag saw. It never holds coordinates. Examples:
  - `fast_travel`: `{ otherKind, otherId, distanceM, minutes }`;
  - `burst`: `{ count, minutes }`;
  - `photo_far`: `{ photoId, distanceM }`;
  - `mock_history`: `{ lastSeenAt, source }`.
- **Mock-location reports:** the phone reports each mocked fix it refuses, at most one report an hour for each place in the app it was refused. A report holds the time, where in the app, and how many, never a location. Reports arrive at `POST /v1/locations/mocked` and are kept in `cell.mock_location_reports`. A report arriving later flags the person's waiting submissions captured in the 30 days after it.
- **Settings:** `anomalyFlagsOff: AnomalyFlag[]`, default `[]`, like `modulesOff`. A switched-off flag isn't judged. Flags already given stay.

**Spec:** M6, M7, BR-32, BR-40; D49, D51, D109. New: BR-50 (the five flags).

## Global constraints

- **Rules** (`packages/shared/src/anomalies.ts`):
  - the constants are `ANOMALY_FLAGS`, `PHOTO_FAR_M = 150`, `PHOTO_FAR_ACCURACY_CAP_M = 100`, `FAST_TRAVEL_KMH = 100`, `FAST_TRAVEL_MIN_M = 5_000`, `BURST_COUNT = 3`, `BURST_WINDOW_MS = 10 min`, `BURST_APART_M = 300`, `MOCK_HISTORY_DAYS = 30`, `MOCK_REPORT_KEEP_DAYS = 90`, `ANOMALY_LOOK_HOURS = 12`;
  - the functions are `photoFar(photos, record)`, `fastTravel(record, others)`, `burst(record, others)` and `mockHistory(capturedAt, lastReportAt, photos)`, each giving its note or null;
  - `anomalyFlags(input, off)` gives all the flags and their notes, leaving out those in `off`.
- **The flag enum:** the five values join `SUBMISSION_FLAGS` and the `cell.submission_flag` Postgres enum (migration 0086, `ALTER TYPE … ADD VALUE`).
- **Table:** `cell.mock_location_reports(tenant_id, id, user_id, device_id, seen_at, source, count, received_at)`:
  - key `(tenant_id, id)`, with an index on `(tenant_id, user_id, seen_at)`;
  - RLS, and a cross-tenant fixture;
  - `source` is one of `tracking`, `punch`, `visit`, `form` and `photo`.
- **Keeping reports:** they are personal data. Erasure removes them (`ShiftsService.erasePerson()`), the nightly field job removes those older than 90 days, and they go into the personal archive on their own. They are added to `docs/security/data-classification.md`.
- **Route:** `POST /v1/locations/mocked`, `@SignedIn()`, phones only, idempotent by the report's ID:
  - the body is `{ id, seenAt, source, count }`, with `count` from 1 to 10,000;
  - a `seenAt` in the future or outside the sync window is refused.
- **Words:** English and Hindi.
  - `submissions.flag_<flag>` names each flag. The review page explains it with `review.anomaly_<flag>`, with figures through `formatNumber`, and names the other record's kind and time.
  - Settings › Rules gains an "Evidence checks" group with one switch per flag.
- **Privacy:** the notice already says the app records "whether a location came from an app that fakes locations" (`privacy.collect_device`). No new data type, so the store answers stay as they are; the plan notes this in the pull request.

## Review focus

1. **Records arriving out of order:** a submission captured before an earlier-received one still makes the pair `fast_travel`, and both waiting submissions are flagged. Tested.
2. **GPS drift:** two records 4.9 km apart a minute apart aren't `fast_travel`, and a burst at one account isn't a `burst`. Tested.
3. **A switched-off flag:** not given, while the others still are. Tested.
4. **A mock report arriving after the submission:** flags the waiting submission captured within 30 days after it, but not one already decided. Tested.
5. **Explanations:** a note holds no coordinates, and the cross-tenant fixture covers the new route. Tested.

---

### Task 1: the rules

- `anomalies.ts` with `anomalies.test.ts`: each flag at, just below and just above its threshold, same-instant records, accuracy allowances, the switches, and notes without coordinates.
- `AnomalyFlag`, the setting `anomalyFlagsOff` with its default, and `SUBMISSION_FLAGS`.
- [x] Tests (unit).

### Task 2: the server

- Migration 0086: the enum values, `submissions.flag_notes`, and `cell.mock_location_reports`.
- `SubmissionsService.create()`:
  - reads the neighbouring records through the field module's own reads (`VisitsService`, `ShiftsService`);
  - adds the flags and notes;
  - flags waiting neighbours.
- `MockLocationReports`, with the route, the nightly purge and erasure.
- The review detail answers `flagNotes`. `pnpm openapi`.
- [x] Tests (integration):
  - each flag through a real submission;
  - out of order;
  - a switch off;
  - a late report;
  - an idempotent resend of a report;
  - erasure;
  - the cross-tenant fixtures.

### Task 3: the portal (pull request 1)

- The review queue's flag filter lists the new flags.
- The review detail explains each flag.
- Settings › Rules gets its "Evidence checks" switches.
- [x] Tests (Vitest and Playwright with axe).

### Task 4: the phone (pull request 2)

- `reportMocked(sync, owner, source)` in `apps/mobile/src/mocked.ts` enqueues the outbox kind `mock_location.report`, at most once an hour for each source, counting what it holds back into the next report (the hour is kept in `sync_state`). It is called:
  - by the background task, for `Tracking.record()`'s `MOCKED` drops;
  - by the punch-in, punch-out, check-in and form refusals of a mocked fix, through `useReportMocked()`.
- The camera needs no report: a photo keeps its own fix, mocked or not, and the server flags it directly.
- The sender and its label in `outbox-kinds.ts`.
- [x] Tests (Jest), and `device.int.test.ts` sending a report as a simulated phone.

### Task 5: finish

- [x] Decision D119, spec M7 and BR-50, `CLAUDE.md`, the progress row and tracker; `pnpm verify` before each merge.
