# Stage U8: Plans, attendance and leave — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax.

**Goal:** A person's plan reads as the prototype's `WebPlans` (a month calendar beside the month's targets, with the plan's decision on the page), and a new Attendance page reads as `WebAttendance` (a register of people by days, a legend, and what waits for a decision), with the team's leave beside it.

**Architecture:** Two API tasks (the register, the team's leave), then the plan page, then the Attendance page.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage U8; the prototype's `WebPlans.dc.html` and `WebAttendance.dc.html`.

## Global constraints

- Module boundaries: the field module already imports planning, so planning can't read calendars or leave without a cycle. The plan page builds its days from what the portal already reads: the person's calendar (`GET /v1/calendars`, their `calendarKey`) and leave (`GET /v1/leave-requests?userId=&year=`). This replaces the revamp plan's `PlanItemListResult.days[]`.
- No new permission: the register takes `user.view`, as each person's attendance (`GET /v1/attendance`) does, narrowed to the caller's scope; it belongs to the `leave_attendance` module. The team's leave is the same scope.
- The register reads through `AttendanceService.days()`, the rule the stored days and the report use, on the replica (`@FromReplica()`).
- Nothing on the plan page is lost: Generate, Submit, Plan a visit, cancelling a visit, routes. The visits table stays below the calendar.
- Approve and Send back on the plan page go through the approvals engine (`POST /v1/approvals/{id}/decision` with the instance's version), shown only while the plan waits for the caller.
- Day letters and their names in English and Hindi; colours from the status tokens through the design system's badge tones; the register's cells name the person, day and status for screen readers.
- Out of scope (feature decision 4): the register's manager filter (territory only, as the prototype shows); the calendar's "1 meeting" counts by purpose.

## Review focus

1. **A month that starts on a Sunday, and February.** The calendar starts on Monday with blank cells before the 1st and ends on the last day. Tested.
2. **No plan approval in the tenant** (`approval` null). No status, no Approve or Send back. Tested.
3. **Leave or attendance switched off.** The calendar shows no weekly offs or leave and still lists visits; the Attendance rail entry is gone. Tested.
4. **A person outside the caller's scope** in the register's territory. Never listed. Tested in the API.
5. **390 px.** The calendar and the register scroll inside their boxes with the name column held; the targets and waiting panels stack below. Checked in the browser.

---

### Task 1: the register (API)

- `AttendanceRegisterQuery {period, territoryId?, cursor?, limit 1–100 (50)}` and `AttendanceRegisterResult {period, items: [{user: {id, code, name}, days: [{date, status}], present}], nextCursor}` in `packages/shared/src/schemas/field.ts`; `present` sums the present and half days' values.
- `GET /v1/attendance/register` in the field module's attendance controller: `@RequiresAny('user.view')`, `@InModule('leave_attendance')`, `@FromReplica()`; people from `Scopes.userIds()` intersected with `TerritoriesService.usersAttachedUnder()` for the month, employed in it, by name, paged by offset cursor; days from `AttendanceService.days()`.
- Cross-tenant fixture: B's register holds nothing of A's; A's territory answers `NOT_FOUND`.
- [x] Tests (`test/attendance.int.test.ts`): statuses per day for two people; a territory narrows; someone out of scope never appears; paging.

### Task 2: the team's leave (API)

- `LeaveRequestListQuery` gains `team: boolean` (query `true`) with `period`: everyone the caller reaches, requests overlapping the month, newest first. Without `team`, unchanged.
- [x] Tests (`test/leave.int.test.ts`): a manager sees their team's request in the month and not one outside it; a field person asking for `team` sees only their own; cross-tenant fixture updated.

### Task 3: the plan page

- `MonthCalendar` (`apps/web/src/planning/month-calendar.tsx`): a table of weeks from Monday, each day its date, title and detail, tone `off` (sunken), `leave` (info tint) or none.
- Day text: the route's name when the day's visits came from one route, else the first account's name (two lines at most); "N stops"; "Weekly off", the holiday's name, "Leave" or "Leave asked" with the type.
- Header: Avatar, "Ravi Kumar · November", meta "SME · Sanwer · 23 working days · 164 planned stops", the plan's status, Approve plan and Send back (with a note) while it waits for the caller, Generate and Submit as now; a `PeriodStepper` replaces the month field.
- Targets panel: "November targets", Locked with its date, metric, target and so far (the month's performance), who set them, Unlock with a reason (`target.unlock`) and Copy to December (`target.edit`).
- [x] Tests (`plan.test.tsx`): weekly off, holiday and leave days; route names and stop counts; the month starts on Monday; approve sends the version; no approval, no buttons; the targets panel with unlock and copy.

### Task 4: the Attendance page

- Route `/attendance`, rail entry Attendance under Team (`user.view`, `leave_attendance` on).
- Header "Attendance · October", meta, territory picker, Holidays (`calendar.manage`, to Settings › Calendars), Export register (the `attendance_register` export, then Reports); `PeriodStepper`; a legend of the letters.
- Tabs Register and Leave. Register: the grid (sticky name column, a letter a day, P total), Load more. Leave: the team's requests (person, type, dates, days, state).
- Beside them, "Waiting for a decision · N": leave and regularisation from the inbox, each opening the approvals inbox.
- [x] Tests (`attendance.test.tsx`): letters and totals; the territory filter asks again; the legend; waiting items; the leave tab; no rail entry with the module off.

### Task 5: finish

- [x] e2e mocks and an axe test of `/attendance`; `tools/ui-compare --only plans,attendance` (with the attendance pair pointing at `/attendance`); 390 px in Hindi; the gallery; the progress row; the pull request and `pnpm verify`.
