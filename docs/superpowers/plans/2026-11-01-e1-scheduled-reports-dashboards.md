# Phase 4 step E1: scheduled reports and custom dashboards — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the advanced analytics module (spec 5.13, M18). Its first part is reports and the workbook (D112) sent weekly or monthly to chosen people by email: each recipient gets the report as they may see it, through a sign-in link. Its second part is a Home layout per role that an admin builds from metric tiles, charts and the existing cards.

**Kunal's answers (2026-11-01), decision D122:**

| Question | Answer |
|---|---|
| Whose data | Each recipient gets the report as they themselves may see it at send time: their own scope and permissions. Recipients are users of the organisation who may export. Someone who loses access stops receiving it |
| Delivery | The email says the report is ready and links to the portal, where the file waits 7 days like any export. No data travels in the email, and every download stays audited |
| Frequency | Weekly, on a chosen weekday, with the month so far. Monthly, on the 1st, with last month complete. Either goes at a chosen time on the organisation's clock |
| Dashboards | One Home layout per role: an ordered list of cards (metric tiles, a trend chart, a metric by person or territory, form mix, leaderboard, on duty, waiting). Each card follows the viewer's own scope and permissions. A role without a layout keeps today's Home |

**Spec:** M18, 5.13, M16; D62, D63, D86, D98, D99, D112. New: BR-52.

## Global constraints

- **The module:**
  - `advanced_analytics` joins `AVAILABLE_MODULES`.
  - `MODULE_PERMISSIONS.advanced_analytics` is `['report.schedule', 'dashboard.manage']`. Both also go in `PERMISSIONS_BY_AREA.data`, with their names in the roles screen's strings.
  - Each template's tenant admin role gets both, and business heads and managers get `report.schedule` (a business head must hold what the managers they manage hold). Raise each template's `version`. Migration 0090 gives existing tenants' admins both.
  - Switched off: no schedule runs and every role sees today's Home. Switched on again, at most the latest missed moment sends, once.
- **Rules:** pure functions in `packages/shared/src/report-schedules.ts` (BR-52):
  - `sendDue(timing, activeFrom, now): string | null`, with `latestSendDate()` and `nextSendDate()`. `timing` is `{ frequency: 'weekly' | 'monthly', weekday: 1–7 | null, at: 'HH:MM' }`; `activeFrom` and `now` are moments on the tenant's clock (`{ date, time }`). It gives the local date of the latest send moment after the schedule started, or null, so nothing converts to UTC and a change of the clock can't skip or repeat a send. (Changed while building from a stored `next_run_at`.)
  - `scheduledPeriod(frequency, runAt, timezone): Period`. Monthly gives the month before the run. Weekly gives the month of the day before the run, so a Monday the 1st sends last month complete.
  - The body's checks, as refinements of `CreateReportScheduleBody` in `schemas/report-schedules.ts`:
    - a weekday if and only if weekly;
    - `at` as `HH:MM`;
    - 1 to 20 recipients;
    - the workbook only as xlsx;
    - a report in `REPORT_FOR_ONE_PERSON` only with `userId`;
    - filters without `period`.
  - Fixtures FX-46 to FX-48: the latest and next send across a month's end; a weekly send on the 1st; one send for three weeks missed, and none for a moment before the schedule started. A unit test keeps a Sunday send in place across Europe's clock change.
- **Tables** (all with RLS, keys led by `tenant_id`, and cross-tenant fixtures):
  - `cell.report_schedules`: `(tenant_id, id, owner_id, report, filters jsonb, format, locale, frequency, weekday, at, status 'active'|'paused', paused_reason, active_from timestamptz, ended_at, …change columns)`, with a partial index on `tenant_id` where active and not ended.
  - `cell.report_schedule_recipients`: `(tenant_id, schedule_id, user_id, added_at, left_at)`, with primary key `(tenant_id, schedule_id, user_id)`.
  - `cell.report_schedule_runs`: `(tenant_id, id, schedule_id, run_key date, period, created_at)`, unique `(tenant_id, schedule_id, run_key)`.
  - `cell.export_jobs` gains nullable `schedule_id` and `run_id`.
  - `cell.dashboard_layouts`: `(tenant_id, role_id, cards jsonb, …change columns)`, with primary key `(tenant_id, role_id)`. Setting `cards` to null brings back today's Home, since nothing is hard deleted.
- **Sending:**
  - `ReportSchedulesService.due(tenantId)` runs every 15 minutes for each tenant (`Schedules.everyForTenants`, the `exports` queue). It takes due schedules with `FOR UPDATE SKIP LOCKED`, 50 at a time.
  - For each schedule, in one transaction, it:
    - records the run (`ON CONFLICT DO NOTHING` on the run key);
    - creates one export per active recipient, with `created_by` the recipient, so the export is theirs alone and runs as `onBehalfOf` them;
    - keys the run by the send's local date (`sendDue()`), so a scheduler down for hours sends each schedule once, not once per missed moment.
  - Exports queue after commit, under the plan's per-tenant slots (D98).
  - When the owner may no longer schedule, the schedule pauses with a reason (audited). When a recipient may no longer export, their export fails with the existing reason and the others still go.
- **Telling people:**
  - A new notification kind `report.scheduled`: category `imports`, `external: ['email']`, in the inbox. Its strings are `notify.report_scheduled_title` and `_body`, with the report's name and month.
  - The `export.finished` event gains `scheduleId`. Its consumer sends `report.scheduled` for scheduled exports, and today's notice for the rest, never both.
  - Every email for a notification with a link now ends with the portal address (`WEB_URL` + link). This also helps the import emails.
  - Scheduled exports link to `/reports?export=<id>`, which signs in and opens that export's download.
- **Personal data:**
  - When a person is erased, they leave every schedule and the schedules they own end. This is `ReportSchedulesService.erasePerson()`, called from `DataRequestsService`.
  - Recipients and owners refer to users, so access-request archives pick them up on their own.
- **Audit actions:** `report_schedule.created`, `changed`, `paused`, `resumed`, `ended` and `left`. A schedule's exports record `export.created` with the system actor and the schedule's ID.
- **Dashboard cards** (`DashboardCard` in `packages/shared/src/schemas/dashboard.ts`, a discriminated union on `kind`):
  - `tiles` with 1 to 8 metric keys;
  - `trend` with 1 to 4 additive metric keys;
  - `breakdown` with a metric, and `by: 'person'` or `by: 'territory'` with a geography level key. By territory takes additive metrics only;
  - `mix`, `leaderboard`, `on_duty` and `waiting`, each at most once.

  A layout holds 1 to 12 cards. `dashboardLayoutIssues(cards, metrics, levels)` in `@thelamp/shared` checks keys, additivity, levels and repeats, with `issueAt` paths.
- **Words:** English and Hindi throughout.

## Review focus

1. **A recipient who can't see what the filters name**, such as a manager outside their scope. Their export fails with the reason, the others get theirs, and the owner's run history shows each recipient's outcome. Tested.
2. **The scheduler down past a send time.** On recovery each schedule sends once, for the latest moment, then waits for the next one. Tested.
3. **A run's job retried.** It still makes one export per recipient, through the run's unique key. Tested.
4. **A layout naming a metric since made unavailable, or a level removed.** The card is left out on read, and the builder marks it missing. Tested.
5. **The module switched off and on.** Schedules don't run while it is off, and switched on again only the latest moment can send, once. Home falls back while off. Tested.

---

### Pull request 1: scheduled reports (the server and the portal)

#### Task 1: the rules and the module

- `report-schedules.ts` with FX-46 to FX-48, the two permissions, `AVAILABLE_MODULES`, the template roles and their versions, and the strings for the permissions.
- [x] Tests (unit).

#### Task 2: the server

- The migration for the three schedule tables and the export columns.
- The schemas in `packages/shared/src/schemas/report-schedules.ts`.
- `ReportSchedulesService` in the reports module. It checks recipients against the owner's scope (`Scopes`), and each must hold `export.create`. The routes (`report.schedule`, `@InModule('advanced_analytics')` where needed):
  - `GET /v1/report-schedules`: the caller's own; with `?for=me`, those they receive;
  - `POST /v1/report-schedules`, with a client ID wrapped in `idempotent()`;
  - `GET /v1/report-schedules/{id}`, with the last 10 runs and each recipient's outcome;
  - `PUT /v1/report-schedules/{id}`: change, pause or resume;
  - `POST /v1/report-schedules/{id}/end`;
  - `POST /v1/report-schedules/{id}/leave`: any recipient, `@SignedIn()`.
- The due job, the notification kind, the email link, the erasure step, `pnpm openapi`, and the cross-tenant fixtures.
- [x] Tests (integration):
  - creating and checking a schedule;
  - a run sending to two recipients, each seeing only their own scope (a manager and a field person);
  - the email in `MemoryEmailSender` carrying the link;
  - a retried run;
  - a missed run;
  - an owner losing the permission;
  - a recipient leaving;
  - the module off and on;
  - erasure;
  - the workbook.

#### Task 3: the portal

- On the Reports page, "Schedule this report" next to Export, starting from the current filters without the month.
- A Scheduled tab with "Yours" (report, how often, next send, recipients, status; pause, resume, end) and "Sent to you" (with "Stop sending me this").
- The schedule form: report or every report, format, weekly with a weekday or monthly, time, language, and recipients from the people the owner sees.
- Each schedule's runs, ten a page (D106).
- `/reports?export=<id>` opens that export.
- [x] Tests (Vitest and Playwright with axe).

### Pull request 2: Home layouts (the server, the builder and the portal's Home)

#### Task 4: the server

- The `dashboard_layouts` migration.
- `DashboardLayoutsService` in the reports module:
  - `GET /v1/dashboard-layouts` and `PUT /v1/dashboard-layouts/{roleId}` (`dashboard.manage`, audited as `dashboard_layout.changed`, calling `TenantConfigService.touch()`).
  - `GET /v1/dashboard` gains `layout` (the caller's role's cards, or null when there is none or the module is off) and `breakdowns`.
  - With a layout, `tiles` and `trend` hold the metrics its cards name, in their order.
- `PerformanceService.breakdown(tx, access, period, metric, by, level?)`: the top 10 people in scope by the metric, with target attainment; or the territories at the level that the scope reaches, summed from daily facts.
- [ ] Tests (integration):
  - a layout per role;
  - each kind of card;
  - a breakdown within scope;
  - a missing metric dropped;
  - the module off;
  - the cross-tenant fixtures.

#### Task 5: the builder and Home

- Settings › Dashboards (`apps/web/src/settings/dashboards-page.tsx`): pick a role, then add, move up and down, edit and remove cards, with no dragging so it works from the keyboard. "Use the standard Home" sets the layout to null. Field errors come from the API by path.
- Home renders the layout's cards in order: the existing card components, and a new `Breakdown` bar chart through `Chart`, with its table of the numbers.
- [ ] Tests (Vitest and Playwright with axe).

### Pull request 3: the phone, configuration and the demo

#### Task 6

- `GET /v1/performance` gains `tileKeys`, the caller's layout's first tiles card. My month on the phone shows those metrics first and the rest after.
- A `dashboards` section in the template schema, by role key, optional. It joins the configuration export and its import, which adds and updates but never removes (D66), and `CONFIGURATION_SECTIONS`.
- The demo content gives each demo tenant's manager role a layout and the admin a monthly workbook schedule.
- [ ] Tests (Jest, configuration integration, demo-content integration).

#### Task 7: finish

- [ ] Decision D122, spec 5.13, M16, M18 and BR-52, `CLAUDE.md`, the progress rows and tracker; `pnpm verify` before each merge.
- [ ] Production email waits on SES leaving its sandbox, already an open item.
