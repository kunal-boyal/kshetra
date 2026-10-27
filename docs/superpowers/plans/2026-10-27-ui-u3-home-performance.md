# Stage U3: Home, performance and the leaderboard — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Home, the team's performance and the leaderboard look like the prototype's `WebHome` and `WebPerformance`, with the figures they show that the API doesn't give today.

**Architecture:**
- **One API task first:**
  - leaderboard and team rows gain each person's territory, their rank at the end of last week, and the leaderboard gains per-metric figures;
  - the dashboard's waiting part gains plans, leave and expenses, and the dashboard gains who is on duty now and how many are on leave.
- **Then three screens,** composed from U1's parts.
- **Last week's rank:**
  - It is the same ranking computed over the month's facts up to the end of last week (Sunday on the tenant's clock), computed on read.
  - It is null on the month's first week, or when that cut-off falls before the month began.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage U3; the prototype's `WebHome.dc.html` and `WebPerformance.dc.html` in `tools/ui-compare/prototype/`.

## Global constraints

- Scores and ranks stay `scoreOf()` and `rankByScore()` (BR-06, BR-07). Only approved work counts; pending is shown apart.
- Territories come through `TerritoriesService` (the module boundary). Leave and expense counts come through those modules' services.
- Every word goes in en and hi. Metric names stay the tenant's terms.
- Nothing is lost:
  - the forms mix chart, the Show the numbers tables, the indicative note;
  - the team/self view, the person page's draft-target badge;
  - the team totals row and the links to each person's month.

## Review focus

1. **A month just begun.** No previous rank shows "–", never "Up 0", and the team's first week has no movement column noise. Tested in the API and in the leaderboard page.
2. **People without a territory or targets.** The territory cell is "–"; unranked people sit after the ranked, without a rank badge. Tested.
3. **The viewer's own row.** It is tinted on the leaderboard and in Home's top five, even when the viewer isn't in the top five (they're shown after a gap, as today). Tested.
4. **Self view.** A field person's Home has no "On duty now" or "Waiting for you" parts, since they lack the permissions; their tiles are their own. Tested.
5. **Hindi and long names at 390 px.** Leaderboard rows and Home's KPI tiles wrap without overflow. Checked in the browser.

---

### Task 1: the figures (API)

**Files:**
- `packages/shared/src/schemas/performance.ts`:
  - `Leaderboard.rows[]` and `TeamPerformance.rows[]` gain `territory: { code, name } | null` and `previousRank: int | null`;
  - `Leaderboard` gains `metrics: PerformanceMetric[]`, `rows[].figures: record(Key, MetricFigures)`, and `groups[].size`.
- `packages/shared/src/schemas/dashboard.ts`:
  - `DashboardWaiting` gains `plans`, `leave` and `expenses` (int or null);
  - `DashboardResult` gains `onDutyPeople: { user, place: string | null, visits: int, seenAt: datetime | null }[] | null` (up to 8) and `onLeaveToday: int | null`.
- `apps/api/src/modules/territories/territories.service.ts`: `primaryOf(tx, tenantId, userIds, date): Map<userId, { code, name }>`. It gives the first territory each person holds on that day, by the territory's code.
- `apps/api/src/modules/performance/performance.service.ts`:
  - `values()`, `scores()` and `ranking()` take an optional `until` date;
  - `leaderboard()` and `figuresFor()` add territory and `previousRank`;
  - `leaderboard()` reuses `figuresFor()` for the rows' figures.
- `apps/api/src/modules/reports/dashboard.service.ts`:
  - `waiting()` adds the counts the approvals inbox already has by type (`journey_plan`, `leave` with `regularisation`, `expense`);
  - `onDutyPeople` and `onLeaveToday` go through `ShiftsService`, `VisitsService` and the leave module's `AttendanceLeave`.
- Tests: `test/performance.int.test.ts` and `test/reports.int.test.ts`; `pnpm openapi`.

- [ ] Test:
  - a leaderboard row carries the person's territory and last week's rank;
  - mid-month, a person who climbed has `previousRank > rank`;
  - on the 3rd of the month every `previousRank` is null.
- [ ] Test: the manager's dashboard has `onDutyPeople` with visits today, and `waiting.leave` counts a waiting leave request; the field person's has all of them null.
- [ ] Implement; run those two files and the cross-tenant test; commit.

### Task 2: Home

**Files:** `apps/web/src/pages/home.tsx`, `home.test.tsx`, the strings; a new `apps/web/src/performance/metric-look.ts`. It gives each metric's icon and hue from its unit and source, for example visits a pin in mint, money a cart in butter, coverage a store in sky, and counts a check in sage.

- Header:
  - the `PageHeader` title is the greeting by time of day ("Good afternoon, Kavita": `home.greeting_morning|afternoon|evening`);
  - the meta line reads "Tuesday 27 October · your team · updated 2:31 pm";
  - the actions are a `PeriodStepper` and a Reports button.
- KPI tiles:
  - four across at 1440 px, two at 768 px, one at 390 px;
  - each metric gets its own icon and hue from `metric-look.ts` and links to its performance;
  - a first "On duty now" `StatTile`: "38 of 46 people · 6 on leave", with a bar (team view only).
- Trend card:
  - the title names the metric ("Visits by day");
  - the legend and Show the numbers move to its header row;
  - it takes 2fr beside the leaderboard card at 1fr.
- Leaderboard card: the top five as `ListItem`s with `RankBadge`, the name, the territory in meta and the score in `metric-md`; the viewer's row is selected; an "All" link.
- "On duty now" card: a table of `Avatar`, person, where, visits today and last seen, with last seen as a toned badge (under 5 min success, under 30 min pending, else neutral, paused neutral); a "Live map" link.
- "Waiting for you" card: a `List` of hued icon chips, the label, and pending counts as `ks-badge pending`, for reviews, approvals, plans, leave and claims.
- The forms mix chart stays, below, full width.
- [ ] Tests:
  - the greeting changes with the hour;
  - tiles link to their metric;
  - the on-duty table lists people with their badge tone;
  - the waiting list shows only what isn't null;
  - a field person sees neither card.

### Task 3: the leaderboard and team performance

**Files:** `apps/web/src/performance/leaderboard-page.tsx`, `team-page.tsx`, `person-page.tsx`, `performance.test.tsx`, the strings.

- **Leaderboard:**
  - `PageHeader` title "Leaderboard · October", meta "Ranked on locked targets · scores update as reviews land", actions an Export button (the target achievement report);
  - the toolbar holds the ranking groups as `FilterChips` with their sizes, and a `PeriodStepper`.
  - A "How the score is made" card: a `ShareBar` of the score's weights, with a "Change in settings" link for those who manage metrics.
  - The table has these columns:
    - rank (`RankBadge`);
    - `Avatar` and name, linking to the person's month;
    - territory;
    - each scored metric's attainment %;
    - score (bold, right-aligned);
    - "Since last week" as a toned badge, in the prototype's words: "Up n" success, "Down n" danger, "Same" neutral, and "–" when there is nothing to compare.
  - The viewer's row is selected; the indicative note stays.
- **Team performance:**
  - rank first (`RankBadge`), then name with `Avatar`, territory, then each metric as the attainment % with the actual in its title, and score and movement;
  - the totals stay in `tfoot`;
  - group chips filter the rows by designation.
- **Person page:**
  - the header gets an `Avatar` lg, with designation and territory in meta;
  - a score card shows the score, rank of group size and movement;
  - metric tiles keep "of target".
- [ ] Tests:
  - the leaderboard shows group chips with sizes and switching groups asks for that group;
  - the share bar holds each weight;
  - movement shows "Up 2" for a climb, "Same" for none and "–" with nothing to compare;
  - the viewer's row has `aria-selected`;
  - the team page puts rank first.

### Task 4: finish

- [ ] Rerun `tools/ui-compare` (Home, performance, leaderboard).
- [ ] Check in the browser at 390 px in Hindi.
- [ ] Publish the gallery update.
- [ ] Add the progress row.
- [ ] Open the pull request, run `pnpm verify`, and wait for Kunal.
