# Stage M2: sign-in and Home — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The phone's sign-in and Home read as the prototype's `AppSignIn` and `AppHome`: sign-in under a Forest band with six code boxes, the masked number and what signing in binds; Home with a greeting and the day's route, the inbox as an icon with a count, the shift with time, distance and visits, today's plan as progress and the next stop, a grid of things to start, and My month as two tiles with the rank.

**Architecture:** Two data tasks (plan items carry their route; the phone keeps the shift's distance), the code input in `@thelamp/ui-mobile`, then the two screens, then the comparison tool's phone pairs.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage M2; the prototype's `AppSignIn.dc.html`, `AppHome.dc.html` and `PhoneTabs.dc.html`.

## Global constraints

- The sign-in band is the product's own Forest, as the web's sign-in panel is (the brand book's "sign-in panel"); the mark is white on it.
- The code field stays one text input that the SMS fills by itself (`oneTimeCode`, `sms-otp`), drawn as six boxes; Maestro flows keep finding it by its label.
- The number is shown masked (`maskPhone()`), never in full, after it is sent.
- Plan items carry `routeId`, `routeName` and `position` (the account's place on its route), so Home names the day's route and the next stop; the `plan_items` entity's version rises to 2 and a route's change reaches phones through the scope.
- The shift's distance is counted on the phone from the points it keeps, a step counted only once it is longer than the point's accuracy and at least 25 m, so standing still adds nothing; it is shown as "about", and the server's trail stays the record.
- Visits today are today's plan items visited or completed, which unplanned visits join once they sync.
- Screenshots sign in a fresh test person from `e2e:fixtures`, never a seeded or demo person (Kunal, 2026-10-28).
- Nothing is lost: the sync banner, announcements, the visit in progress, the shift's pause and resume, the language switch, resend and the change of number.

## Review focus

1. **No plan today.** The plan card says so, with no bar or next stop. Tested.
2. **Off duty.** The shift card offers punch-in and shows no stats. Tested.
3. **A wrong code.** The boxes show the error under them and keep the digits. Tested.
4. **No route.** The greeting's line names the date alone. Tested.
5. **Hindi at 390 px.** The greeting, tiles and band wrap without clipping. Checked in the browser.

---

### Task 1: plan items carry their route (API, sync)

- `SyncPlanItem` gains `routeId`, `routeName`, `position` (nullable); `PlanItemsSync` joins `routes` and `route_accounts`; its scope adds the person's routes' latest change; `version` 2.
- Local migration: `ref_plan_items` gains `route_id`, `route_name`, `position`.
- [x] Tests (`test/plan-items.sync` or `planning.int.test.ts`; `sync.test.ts`): a route's items carry its name and positions; renaming the route changes the scope.

### Task 2: the shift's distance on the phone

- `shift_state` gains `distance_m`, `last_lat`, `last_lng`; `Tracking.record()` adds each step past the threshold; `ShiftState.distanceMeters` and `lastFix`.
- [x] Tests (`tracking.test.ts`): a walk adds up; jitter within accuracy adds nothing; a new shift starts at 0.

### Task 3: sign-in

- `OtpInput` in `@thelamp/ui-mobile` (six boxes over one input). The Forest band with the white mark and the language pill; the title and intro on it; the number with its +91; the code label with the masked number; the lock notice; the footnote that location is recorded only on duty.
- [x] Tests (`sign-in.test.tsx`): the masked number, a wrong code's error, resend.

### Task 4: Home

- Header: `Avatar`, the greeting by the time of day, the date with the day's route; the inbox as an `IconButton` with the unread count.
- The shift card's three stats (on duty, km, visits) and Punch out as tonal; today's plan as "n of m done" with a `ProgressBar` and the next stop (`SeqBadge`, its type and, with a fix, its distance); "Start something" as four tinted tiles, each shown only with its permission and module; My month as its first two tiles and "Rank #n of m".
- [x] Tests (`home.test.tsx` or the screens' own): greeting by hour, the plan card with and without items, the tiles by permission, the rank.

### Task 5: finish

- [x] Phone pairs in `tools/ui-compare` (sign-in and Home, Expo web at 390 px, a fresh fixtures person); 390 px in Hindi; the gallery; the progress row; the pull request and `pnpm verify`.
