# Stage U5: the live map — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The live map looks like the prototype's `WebLive`: a view switch (Live, Day replay, Visit density, Account pins), dots with initials in three states, a legend over the map, and a side panel of people with summary badges, each row saying where they are and how their day is going.

**Architecture:** One API task (each person's visits today against their plan, where they are, and whether they are off their plan), then the page, on `SegmentedControl`, `ListItem` and new `--map-*` dot tones.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage U5; the prototype's `WebLive.dc.html`.

## Global constraints

- Maps read through the owning modules' services, within the caller's scope (decision D60). Positions stay stale after 15 minutes (`isStale()`).
- Whatever the map shows stays readable in the list beside it; without a Maps key the map is a notice and the list carries everything.
- Every word in en and hi; the plan is named through `{term.journey_plan}`.

## Review focus

1. **Someone with no plan today.** Never "off plan"; their row says "visit 2" without "of". Tested in the API and the page.
2. **Someone with no position yet.** No dot, "No position yet" in the list, counted as no signal. Tested.
3. **Paused people.** "Paused" in their row, grey, not counted as moving. Tested.
4. **No Maps key** (tests, the demo without a key). The legend and the list still show; nothing breaks. Tested.
5. **390 px.** The panel stacks under the map, the switch wraps. Checked in the browser.

---

### Task 1: the figures (API)

**Files:**
- `packages/shared/src/schemas/maps.ts`: `LivePerson` gains `visits: { done: int, planned: int | null }` (`planned` null without plan items today), `place: string | null` (the account of the visit they're at, else of their last visit today), `offPlan: boolean`.
- `apps/api/src/modules/planning/planning.service.ts`: `todayFor(tx, tenantId, userIds, date): Map<userId, accountIds[]>`, non-cancelled items.
- `apps/api/src/modules/maps/maps.service.ts`: visits through `VisitsService.dayCounts()`, plans through `todayFor()`, accounts' places through `AccountsService.geofences()`; `offPlan` when the person's position is more than ten times the tenant's geofence radius from every located account in today's plan.
- [ ] Test (`test/maps.int.test.ts`): a person checked in at a planned shop has `visits {done: 1, planned: 1}`, `place` the shop's name and `offPlan` false; moved 5 km away, `offPlan` true; someone without a plan has `planned: null`, `offPlan` false.

### Task 2: the page

**Files:** `apps/web/src/maps/live-map-page.tsx`, a new `views.tsx` (the switch, also on the density page), `map.tsx` (`Dot` tones `inside`, `outside`, `stale`; `MapLegend`), `app.css`, `maps.test.tsx`, the strings.

- Header: "Live map", meta "Positions refresh every 30 seconds · only people on duty are shown"; the switch: Live, Day replay (a person picker, then the replay page), Visit density (`/density`), Account pins (the accounts layer on the live map).
- Map 640 px high, dots with initials: `inside` moving or at a visit, `outside` off plan, `stale` no signal for 15 minutes or paused. A legend card over the bottom-left.
- Panel: "38 on duty", badges "31 moving · 4 off plan · 3 no signal"; `ListItem`s with a status dot, the name, "At Sharma Stores · visit 4 of 8" / "Moving · Hatod" / "Off the plan" / "Last seen near …" / "Paused", and "now" / "3 min" at the end; a row opens the person's replay for those with `trail.view`. The panel scrolls on its own.
- [ ] Tests: badges count the three states; rows read as above; the replay picker goes to the person's replay; without a key the legend and list still show.

### Task 3: finish

- [ ] e2e mocks; `tools/ui-compare --only live`; 390 px in Hindi; the gallery; the progress row; the pull request and `pnpm verify`.
