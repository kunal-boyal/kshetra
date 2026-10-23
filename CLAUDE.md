# The Lamp

A multi-tenant field-force SaaS: an Android-first mobile app, a tenant web portal, a vendor console and a public API. [docs/spec.md](docs/spec.md) is the source of truth for scope and behaviour. If code and spec disagree, raise it with the owner (Kunal) and change one of them deliberately. Decisions are logged in [docs/decisions.md](docs/decisions.md). Every service the project uses, local and production, is listed in [docs/services.md](docs/services.md).

## Status

Phase 2 (commerce and people) is in progress, by the plan Kunal approved on 2026-10-24 (decision D73). Phase 1 is built but for its pilot week, which waits on the company's accounts, and phase 0 is complete. Start a new phase only with Kunal's explicit go-ahead. [docs/progress.md](docs/progress.md) tracks every step: its status, its pull request, and the open items waiting on the owner. Update it in the same pull request as each step.

Build in the phase order of spec section 15. Meet each phase's exit criteria, tests included, before the next phase starts. Inside a phase, take one capability at a time through every layer: schema, shared rules, API, web, mobile, tests.

## Commands

| Command | What it does | Available |
|---|---|---|
| `pnpm install` | installs the workspace (pnpm 12, Node 24) | now |
| `pnpm typecheck`, `pnpm lint`, `pnpm test` | static checks and unit tests, through Turborepo | now |
| `pnpm format`, `pnpm format:check` | Prettier | now |
| `docker compose up -d` | starts the local services | now |
| `pnpm dev` | runs the API on http://127.0.0.1:3000 with its worker and scheduler, the web portal on http://127.0.0.1:5173 (which passes `/auth` and `/v1` through to the API), and the field app's Expo dev server | now |
| `pnpm --filter @thelamp/mobile go` | serves the field app to Expo Go on a phone on the same Wi-Fi; run the API with `HOST=0.0.0.0 pnpm dev`, or set `HOST` in `.env`. Turborepo passes only the variables `turbo.json` lists to a task (`HOST` and `CORS_ORIGINS` for `dev`), so add any other you need there | now |
| `pnpm --filter @thelamp/api load:fixtures --users N` then `k6 run tools/k6/<script>.js` | load tests against the local API (decision D68, `tools/k6/README.md`); make new fixtures before each run | now |
| `pnpm --filter @thelamp/api e2e:fixtures` then `apps/mobile/.maestro/run.sh <apk>` | the field app's Maestro flows on an emulator (decision D68, `apps/mobile/.maestro/README.md`) | now |
| `pnpm --filter @thelamp/mobile web` | runs the field app in a browser, standing in for an Android phone; development only, so add http://localhost:8081 to `CORS_ORIGINS` | now |
| `pnpm test:int` | integration tests against PostgreSQL in Docker, through Testcontainers (Docker must be running) | now |
| `pnpm test:e2e` | Playwright tests of the web portal, with axe, against a mocked API. Install the browser once with `pnpm --filter @thelamp/web exec playwright install chromium`. | now |
| `pnpm verify` | the full check before a merge (decision D75): formatting, types, lint, unit, phone, integration and web end-to-end tests, Terraform; `--image` builds the container image too. Docker must be running | now |
| `pnpm tokens` | regenerates `tokens.css` and `tokens.ts` in `packages/design-tokens` from `tokens.json` | now |
| `infra/scripts/demo.sh apply\|deploy\|provision\|pause\|resume\|status` | the demo on one EC2 instance in the AWS sandbox (decision D70, `infra/demo/README.md`); signed in with `aws login --profile thelamp-sandbox` | now |
| `pnpm rename --name … [--slug …]` | renames the product across the repository from `product.json` (`tools/rename/README.md`); the slug and app ID only until launch | now |
| `pnpm db:bootstrap` | creates the database roles; refuses anything but a local or CI database | now |
| `pnpm db:migrate` | applies migrations as the `migrator` role | now |
| `pnpm --filter @thelamp/api db:generate` | writes a migration for a schema change | now |
| `pnpm --filter @thelamp/templates schema` | regenerates `packages/templates/schema.json` after a template schema change | now |
| `pnpm db:seed` | seeds two fictional tenants and refuses non-local databases; running it again changes nothing | now |
| `pnpm provision --name … --slug … --template … --admin-name … --admin-phone …` | creates a tenant from a template, with its first admin; `--file <path>` instead of `--template` starts it from another tenant's exported configuration; `--logo` and `--brand-colour` set its branding as Settings would; `--demo` makes a demo tenant (D70) | now |
| `pnpm openapi` | regenerates `apps/api/openapi.json` from the route registry; a test fails while it is out of date | now |
| `docker build -f apps/api/Dockerfile .` | builds the cell's container image (decision D67) | now |

Local services run in Docker Compose. Every port binds to 127.0.0.1, so only this machine can reach them:
- PostgreSQL 18 with PostGIS, pg_partman and pg_trgm, on port 5433 by default (`POSTGRES_PORT`)
- Redis, on port 6380 by default (`REDIS_PORT`)
- MinIO standing in for S3: API on 9000, console at http://localhost:9001. It uses Chainguard's image (decision D21).
- Mailpit: SMTP on 1025, inbox at http://localhost:8025

The non-standard database and Redis ports leave 5432 and 6379 free for copies already installed on the machine.

Locally, OTP codes print to the console (`OTP_PROVIDER=console`); production refuses this.

First run on a new machine:

```bash
cp .env.example .env
docker compose up -d
pnpm db:bootstrap
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The seed prints who can sign in. One person belongs to both seeded tenants, so choosing a tenant after the code can be tried.

Workspace packages are consumed as TypeScript source (`exports` points at `src/index.ts`), so they need no build step. Shared tool versions live once, in the `catalog` of `pnpm-workspace.yaml`. TypeScript stays on 6.0 until typescript-eslint supports 7; see `docs/versions.md`.

## Layout (spec 9.4)

```text
apps/        api (NestJS: main.ts, worker.ts, scheduler.ts, migrate.ts), web, console (Vite SPAs), mobile (Expo)
packages/    shared, forms, metrics, i18n, templates, api-client, design-tokens, ui-web, ui-mobile, config
infra/       terraform modules and environments
tools/       token build (tools/tokens), k6 load tests, data generators
docs/        the specification, decisions.md, versions.md, runbooks/
```

## Rules

- **Naming:** snake_case in the database, camelCase in TypeScript, kebab-case file names, kebab-case plural nouns in API paths. The product's name, slug, package scope and app ID live in `product.json` (decision D1: The Lamp, `thelamp`). Never hard-code them where a setting can carry them (`PRODUCT_NAME`, `PRODUCT_SLUG`); rename only with `pnpm rename`, and name new files without the product's name.
- **No industry words in code.** Distributor, retailer, farmer, doctor, beat, outlet, liquidation and similar terms belong in industry templates, seed data and translation strings. Code speaks of accounts, account types, forms, submissions, metrics, routes and plan items.
- **Tenancy:** every tenant-owned table has `tenant_id` and a row-level security policy from its first migration, indexes led by `tenant_id`, and an entry in the cross-tenant test fixtures. The cross-tenant contract test covers every endpoint.
- **Business rules** (spec section 7) are pure functions in `packages/shared`, tested with the Appendix D fixtures. The server is authoritative; clients call the same functions only to preview.
- **Schemas:** each request and response has one zod schema in `packages/shared/src/schemas/<module>`. Controllers never define ad hoc types. The one exception: a request or response that carries form-engine configuration, such as user fields, keeps its schema in `packages/forms` beside `CustomField`, because `@thelamp/shared` can't depend on that package (decision D41).
- **Module boundaries:** a module never imports another module's repository. Cross-module calls go through exported services or events.
- **Idempotency:** every write takes a client-generated UUID or an `Idempotency-Key` header.
- **Text:** all user-facing text goes through the i18n layer and the terminology resolver, in English and Hindi from the first screen.
- **Secrets and data:** no secrets in the repository; commit `.env.example` only. Seed data is fictional. Destructive resets and seeds refuse to run outside local and CI databases.
- **Dependencies:** use the current stable release on the day each is added, commit the lockfile, and list versions in `docs/versions.md`.
- **Unclear requirements:** check `docs/decisions.md` and spec section 16. If the answer isn't there, stop and ask the owner with concrete options.

## Data (spec 10.1)

- UUID v7 primary keys. Device-created records get their ID on the device.
- Times are `timestamptz` in UTC. Calendar dates are `date` values in the tenant timezone. Periods are `YYYY-MM` text.
- Money is `numeric(18,2)` and goes through a decimal library, never binary floating point. Percentages are `numeric(7,4)`, quantities `numeric(18,3)`.
- Locations are `geography(Point, 4326)` with GiST indexes.
- No hard deletes in application code, except retention jobs and tenant deletion.

## Database (decision D23)

- **Roles:** `migrator` owns the schemas and runs migrations. The API connects as `cell_app`, which can't bypass row-level security. `directory_app` is the only role allowed into the `directory` schema.
- **Tenant data:** reach it only through `Database.forTenant(tenantId, (tx) => …)` in `apps/api/src/platform/database.ts`. It sets `app.tenant_id` for one transaction. Still filter by `tenant_id` in every query.
- **New tenant tables:** put them in the `cell` schema with `tenant_id`, `.enableRLS()` and the `isolation()` policy, as `apps/api/src/db/schema/iam.ts` shows. `test/database.int.test.ts` fails for any `cell` table without them. Primary keys start with `tenant_id` (`(tenant_id, id)`), and references carry it too, so a row can't point into another tenant (decision D30). Syncable tables take `rowVersionColumn()` and a `next_row_version` trigger.
- **Schema changes:** edit the files in `apps/api/src/db/schema/`, run `db:generate`, and review the SQL before committing. Grants, triggers and anything else Drizzle can't express go in a migration made with `drizzle-kit generate --custom`.
- **Idempotent creates:** use `idempotent()` from `src/platform/idempotency.ts` (BR-46).
- **Errors:** throw `AppError` from `@thelamp/shared` with a spec 11.4 code; the global filter writes the spec 11.1 format.

## Sign-in and access (decisions D29 and D30)

- Sign-in lives in `apps/api/src/modules/directory`. Only that module touches the directory schema, through `DirectoryDatabase` as `directory_app`. The directory and the cell reach each other only through the seams in `apps/api/src/platform/planes.ts`: the cell admits each sign-in and binds the phone, and tells the directory whenever a user's sign-in facts change.
- Every route declares who may call it: `@Public()` (health checks and sign-in only), `@SignedIn()`, `@Requires(...)` or `@RequiresAny(...)`, with permissions from spec Appendix E. A route that declares nothing is refused, and `test/iam.int.test.ts` fails. Handlers read the caller with `@CurrentAccess()`.
- Every route also declares what it takes and gives with `@Contract(...)`: a summary, its group, and the shared zod schemas of its path parameters, query, body and answer (decision D37). The route registry (`src/platform/routes.ts`) reads both, and the OpenAPI document and the cross-tenant contract test are built from it. After changing a route, run `pnpm openapi`.
- The global `AuthGuard` checks the token. IAM then checks, on every request, that the tenant, user and device are still active at the token's auth revision.
- Filter records by the caller's data scope with `Scopes` from the IAM module. A record outside the scope answers `OUT_OF_SCOPE`; another tenant's record answers `NOT_FOUND`.
- Nobody gives access they don't hold (`canGrant` in `@thelamp/shared`), and nobody acts on their own record where a rule forbids it, such as resetting their own device.
- Never log phone numbers, one-time codes or tokens. A message that must name a number uses `maskPhone()`.
- Integration tests use `test/support.ts`: `startApp()`, `testConfig()`, and `World`. `World` makes tenants from a template and users through the app's own services, and signs people in on the web, or on a phone with `newDevice()`. Fresh numbers and addresses keep tests from sharing rate limits. `OTP_PROVIDER=memory` keeps codes for tests.

## Configuration bundle and text (decision D31)

- Strings live in `packages/i18n/src/messages/en.ts` and `hi.ts` under stable keys. Add both languages in the same change. A message names a term through a placeholder such as `{term.account:lower}`, never as a word; plural messages carry `one` and `other`.
- Format numbers, money and dates with `formatNumber`, `formatMoney`, `formatDate` and `formatDateTime` from `@thelamp/i18n`. A tenant's "today" is `todayIn(settings.timezone)` from `@thelamp/shared`.
- Tenant settings are `TenantSettings` in `@thelamp/shared`, with `SETTING_DEFAULTS`; read them with `TenantConfigService.settings()`. A new setting needs a default, and settings are never renamed.
- Anything the config bundle holds moves the config version: call `TenantConfigService.touch()` in the same transaction as the change.

## Audit and events (decision D32)

- Every change writes an audit entry with `AuditLog.record()` in the same transaction: the action from `AUDIT_ACTIONS` in `@thelamp/shared`, the target, and the values before and after. `userActor(access)` names the caller; `SYSTEM_ACTOR` names provisioning.
- Publish a domain event with `Outbox.publish()` in the same transaction as the change; it is delivered once the transaction commits, and retried by the relay if a consumer fails. Add event types and payloads to `packages/shared/src/events.ts`.
- Consumers registered with `Outbox.consume()` must be idempotent: delivery is at least once.
- Work that must wait for a commit goes through `Database.afterCommit()`.

## Web portal (decision D35)

- The web never stores a token. The refresh token lives in the directory's httpOnly cookie and the access token in memory, so a reload restores the session with `client.restore()`. Never put a token in `localStorage`, `sessionStorage` or a URL.
- Web code calls the API only through `@thelamp/api-client`, which refreshes tokens and turns error responses into `ApiError` with a spec 11.4 code. Show errors with `errorMessage()` from `apps/web/src/i18n.tsx`.
- Build screens from `@thelamp/ui-web` and the design system's `ks-*` classes; Tailwind is for layout. Text comes from `useLanguage().t`, in English and Hindi.
- Each screen gets a Vitest test with Testing Library, and each page a Playwright test that runs axe.
- Lists use `DataTable` with cursor paging (a Load more button, as the API pages). Actions that can't be undone ask first, in place, with `Confirm`. Field errors come from the API's details by path, with `fieldErrors()` in `apps/web/src/people/shared.tsx`. Writes go through `write()` in `apps/web/src/people/data.ts`, which sends a fresh idempotency key.

## Background work (decision D39)

- Add a queue to `QUEUE_NAMES` in `apps/api/src/platform/queues.ts` with the first work that needs it. Register a handler per kind of job with `Queues.handle()` in the owning module's `onModuleInit`; only the worker process runs handlers.
- A job for one tenant carries `tenantId`, and its handler does its work inside `Database.forTenant`. Handlers are idempotent: a job can run again after a failure.
- Declare repeated work in `Schedules`: `every()` across the cell, `atTenantTime()` for a moment of each tenant's day (`HH:MM` on the tenant's clock). Give one-off jobs that must run once a `jobId`.
- `pnpm dev` runs the API, the worker and the scheduler together (`apps/api/scripts/dev.mjs`); production runs them as separate services.

## Imports and files (decision D42)

- Files live in the object store through the media module (`MediaService.store()` and `read()`), never through S3 directly. Locally that is MinIO, whose bucket the API creates on start; tests use `OBJECT_STORE=memory`.
- The module that owns some records makes them importable: a class implementing `ImportTargetSource`, registered with `ImportTargets` in `onModuleInit`, as `apps/api/src/modules/territories/territories.import.ts` does. `check` finds every problem without writing; `commit` writes every row in the caller's transaction, checking again first, and throws `ImportRefused` rather than write part of a file. Add the target to `IMPORT_TARGETS` in `packages/shared/src/schemas/imports.ts`, its permission to `TARGET_PERMISSIONS` in `apps/web/src/imports/data.ts`, and its field names to the web's `fieldName` and the strings as `import.field_<target>_<key>`.
- Match names in files with `matchName` from `@thelamp/shared` (BR-42); it never guesses between two close names.

## Accounts and approvals (decision D43)

- Who sees an account is `AccountsService.reach()`: today's slot holders within the caller's scope, their territories when the scope covers territory, and what they proposed. List, read and sync through it.
- Account types carry form-engine fields, so their schemas and the full `ConfigBundle` live in `@thelamp/forms`; `@thelamp/shared` has `CoreConfigBundle`. When the bundle gains a part, raise `BUNDLE_SHAPE` in the config-bundle controller so phones fetch it again.
- A request that needs approval registers its type with `RequestTypes` in the owning module and starts with `ApprovalsService.request()` in the same transaction; its `decided()` applies the outcome in the deciding transaction.
- Records made on a phone carry their own IDs: wrap the create in `idempotent()` keyed by `<kind>:<id>`, so a resend replays and a changed body is `IDEMPOTENCY_CONFLICT`.
- Points are `geography(Point, 4326)`: write with `pointSql()`, read with `pointOf()` from `src/platform/geo.ts`.

## Photos (decision D44)

- Photos never pass through the API: the phone uploads straight to storage through `POST /v1/media/presign`'s link, then confirms. Use the `media.upload` outbox kind and `preparePhoto()` and `queuePhoto()` in `apps/mobile/src/photos.ts`; the camera screen (`/camera?kind=&request=`) does both and hands the IDs back through `capture-results.ts`.
- Records that use photos attach them by ID in the transaction that creates the record, after checking their owner and status (spec 12.2, step 5). Read them only through `GET /v1/media/{id}/url`.
- In tests the object store is in memory; `MemoryObjectStore.receive(url, bytes)` stands in for the phone's upload and refuses bytes that weren't signed for.

## Shifts and tracking (decision D47)

- Shifts, points, trails and attendance days live in `apps/api/src/modules/field`. The rules are pure functions in `packages/shared/src/tracking.ts`: `pointRejection()` (BR-36), `punchFixIssue()`, `clockSkewed()` (BR-44), `onDutyMs()`, `compactTrail()` and `dayStatus()` (BR-23 as shifts decide it).
- `cell.location_points` is range-partitioned by day with pg_partman, so Drizzle can't declare it: migration 0018 creates it partitioned. `cell.maintain_location_partitions()` makes the coming days' partitions and gives each one the tenant-isolation policy; the scheduler runs it four times a day. Query points through the parent, always with a `captured_at` range, so only the shift's days are read. Old partitions are dropped once empty (decision D69).
- A shift's start and end publish `shift.started` and `shift.ended`; their consumers keep the person's attendance day and compact the trail. The nightly job (`field.nightly`, 00:30 on the tenant's clock) closes forgotten shifts, compacts what is left and keeps everyone's day just gone.
- Live positions go out on Redis (`positions:<tenantId>`) after the ingest commits, for the live map (M17).
- On the phone (decision D48), `Tracking` in `@thelamp/api-client/sync` keeps the open shift and buffers points, dropping what the server would refuse; points upload only once their shift's punch-in has left the outbox. Punches go through `punchIn()`, `punchOut()`, `pauseShift()` and `resumeShift()` in `apps/mobile/src/tracking.ts`, which save on the phone and queue in one transaction. The background task is defined in `src/background.ts`, imported first by the root layout. Tracking starts only from a punch-in, a resume or "Record again", never by itself (BR-37). Background location needs a development build (`eas build --profile development`, on Kunal's account); Expo Go can't run it.

## Retention (decision D69)

- BR-41's rules are pure functions in `packages/shared/src/retention.ts`: `locationRetention()` says which of a tenant's days are archived, purged and expired. A day is archived only after `LOCATION_SETTLE_DAYS`, the longest sync window and a day, so no phone can still send points for it.
- `LocationArchive` (`apps/api/src/modules/field/location-archive.ts`) runs in `field.nightly`: each settled day's raw points go to the object store as Parquet (`location_archive` media, recorded in `cell.location_archives`), an archived day's points are deleted after the raw retention, and trails and archive files after the trail retention. Never delete points of a day that isn't archived.
- `cell.drop_empty_location_partitions()` runs with the partitions job and drops only empty partitions older than `LOCATION_PARTITION_KEEP_DAYS`.
- Evidence photos and signatures expire in `PhotosService.expireEvidence()` (`media.retention`, nightly per tenant) by the keeping time they were captured under; `MediaService.expire()` removes a file with its derivatives and marks the row deleted. Retention is the app's; the bucket's lifecycle rules only tidy.
- Audit archiving as `locations.archived` and every deletion run as `retention.applied`.

## Visits and submissions (decision D49)

- Judge any record captured in the field with `evidenceIssues`, `photoIssues` and `geofenceResult` from `@thelamp/shared` (BR-32, BR-33), against the shift `ShiftsService.at()` finds for its capture time; `refuseEvidence()` in `apps/api/src/modules/field/evidence.ts` answers with the first problem's code and lists them all.
- An account a record is made at comes from `AccountsService.forCapture()`: seen by the caller, with its status, type, distance from its verified location, radius and geofence policy.
- Records attach their photos with `PhotosService.forRecord()` and `attach()` in the creating transaction. Submissions are immutable; what reviewers should see goes in `flags`.
- Work repeated for each tenant on an interval uses `Schedules.everyForTenants()`.
- On the phone (decision D50), `Visits` in `@thelamp/api-client/sync` keeps the open visit; check in and out through `checkIn()` and `checkOut()`, and submit form entries through `submitEntry()`, all in `apps/mobile/src/visits.ts`, which save on the phone and queue in one transaction. `geofenceAt()` previews the server's geofence judgement. A submitted entry waits while its upload is in the outbox.

## Review (decision D51)

- Review lives in `apps/api/src/modules/review` and reaches submissions only through `SubmissionsService` (`reviewRows()`, `forDecision()`, `setStatus()`, `dueForAutoApproval()`). The rules are pure functions in `packages/shared/src/review.ts`: `reviewRefusal()` (own work, notes) and `autoApprovable()` (flags, geofence, `integrityWarning()`).
- Every decision goes through `ReviewService.record()`: a `submission_reviews` row, the submission's status, an audit entry and the `submission.reviewed` event in one transaction. Consumers of that event (plan items, metrics) must be idempotent.
- Auto-approval runs every 15 minutes for each tenant (`review.auto_approve`); its switch is the `reviewAutoApproval` setting and its delay is in `review_rules`, through `TenantConfigService.reviewRules()`.
- On the phone (decision D52), managers review in the Team tab (`src/screens/team.tsx`, `review-item.tsx`) through the hooks in `apps/mobile/src/review.ts`; reviews go straight to the server, never through the outbox.

## Planning (decisions D53 and D55)

- Routes, plan items and months of plans live in `apps/api/src/modules/planning`. The rules are pure functions in `packages/shared/src/planning.ts`: `routeDates()` (a route's dates in a month) and `nextPlanStatus()` (BR-35).
- A plan item references only an account the planned person sees: judge it with that person's own access (`AccessResolver.onBehalfOf`), never the planner's.
- Plan items move through `PlanningService`: `startVisit()` from a check-in with `planItemId`, `reviewed()` from the `submission.reviewed` and `submission.created` events, `missDayEnded()` nightly. Each change publishes `plan_item.status_changed`.
- Phones keep their own plan items through the `plan_items` sync entity (`plan-items.sync.ts`, decision D54); Home's Today's plan and the visit card read them with `useTodayPlan()` in `apps/mobile/src/screens/today-plan.tsx`.
- Targets and account plans (decision D55) live in the same module: `TargetsService` and `AccountPlansService`. They refer to metrics by key; the tenant's metric definitions are stored from its template by `MetricsService.applyTemplate()` and read with `targetable()`. Judge a value with `targetValueIssue()` and an unlock with `unlockRefusal()` from `@thelamp/shared`. Nobody sets their own targets; a locked set changes only after an unlock, which publishes `target.unlocked` as a lock publishes `target.locked`.

## Metrics and performance (decisions D56 and D57)

- The metric engine lives in `apps/api/src/modules/performance`; definitions stay in `modules/metrics` (`MetricsService.definitions()`, `score()`). `MetricsEngine.recompute(tx, tenantId, userId, date)` rebuilds one person's day from the records the owning modules' `forMetrics()` methods return, through `calculateDayFacts()` in `@thelamp/metrics`. Recomputing is idempotent.
- Anything that changes a person's day recomputes it: the consumers in `performance.upkeep.ts` follow `submission.created`, `submission.reviewed`, `visit.ended` and `plan_item.status_changed`. A new source of metric values needs its event consumed there and its calculator in `calculate.ts`, added to `COMPUTED_SOURCES`.
- Values belong to the capturing person and the capture's date on the tenant's clock (BR-03): filter moments with `onLocalDate()` from `src/platform/local-day.ts`.
- Scores and ranks are `scoreOf()` and `rankByScore()` from `@thelamp/shared` (BR-06, BR-07), computed on read by `PerformanceService` from locked targets; ranking groups are designations marked ranked (D8).
- The web shows a metric with `MetricTile` in `apps/web/src/performance/shared.tsx`, on the design system's `KpiTile` from `@thelamp/ui-web`, and formats values by unit with `useFigure()`.
- On the phone (decision D57), My month on Home (`src/screens/my-month.tsx`) reads `useMyMonth()` from `apps/mobile/src/performance.ts`, kept on the phone with when it was read; tiles use `KpiTile` from `@thelamp/ui-mobile` and `useTileParts()`, which shortens values to lakh and crore. The leaderboard (`/leaderboard`) is read online.

## Notifications (decisions D58 and D59)

- Notifications live in `apps/api/src/modules/notifications`. An event's category, channels in order and urgency are in `NOTIFICATION_KINDS` in `@thelamp/shared`; its text is `notify.*` in the i18n catalogue, chosen by `notificationMessage()` from `@thelamp/i18n`, which the server, the web and the phone all use. A new event needs all three.
- Notify with `NotificationsService.notify(tx, tenantId, { userId, event, values, link, dedupeKey })` in the transaction of the change, usually from an outbox consumer in `notifications.upkeep.ts`. The `dedupeKey` names the occurrence, so a redelivered event notifies once. Values that differ by language go in as `<name>_en` and `<name>_hi`.
- Delivery runs on the `notifications` queue (`NotificationDelivery`): push, then the next channel when one can't reach the person. Senders follow `PUSH_PROVIDER`, `SMS_PROVIDER` and `EMAIL_PROVIDER`: console locally, memory in tests (`MemoryPushSender` and friends), refused in production. Never log a number, address or token unmasked: use `maskPhone()`, `maskEmail()` and `maskToken()`.
- On the phone (decision D59), `usePushRegistration()` and `useNotificationTaps()` in `apps/mobile/src/push.ts` run in the signed-in layout; a tapped notification opens its link through `openLink()`, and `APP_PATHS` lists the screens it may open. The inbox is `src/screens/notifications.tsx` with the hooks in `src/notifications.ts`. Push needs a development build and Firebase's `google-services.json`, which EAS supplies as the `GOOGLE_SERVICES_JSON` file variable and is never committed. In Jest, mock `expo-notifications` and `expo-device`.

## Maps (decisions D60 and D61)

- Map reads live in `apps/api/src/modules/maps`: `GET /v1/live`, `/v1/account-pins`, `/v1/trails` and `/v1/density`. They reach shifts, points, trails, visits and accounts only through those modules' services, within the caller's scope. The rules are pure functions in `packages/shared/src/maps.ts`: `isStale()`, `positionAt()`, `pathLengthMeters()` and `decodePolyline()`.
- The web draws maps only through `apps/web/src/maps/map.tsx` (`MapView`, `Dot`, `Route`, `Area`), on `@vis.gl/react-google-maps`, with colours from the tokens: status tones, and `seriesOf()` for account types, filled once visited. Without `VITE_GOOGLE_MAPS_API_KEY` a map shows a notice, as in Vitest and Playwright; keep whatever a map shows also readable in a list or table beside it.
- `VITE_` settings come from the root `.env` (`envDir`). Only the vendor keys exist for now; per-tenant keys arrive in step 16.
- On the phone (decision D61), draw maps only through `apps/mobile/src/maps.tsx` (`PhoneMap`, `Spot`, `Ring`, `Line`) on react-native-maps; `maps.web.tsx` stands in for the web target and `jest.setup.ts` mocks the library, so a map in a test is a view labelled with its name and markers with their titles. Android's key comes from `GOOGLE_MAPS_ANDROID_KEY` in EAS through the config plugin in `app.config.ts`, never committed. Managers' live and trail reads are `useLive()` and `useTrail()` in `src/maps-data.ts`, online only.

## Dashboards, reports and exports (decisions D62 and D63)

- Reports live in `apps/api/src/modules/reports`. A report is a `ReportSource` (`sources.ts`) registered in `ReportsService`: its columns and a page of rows, read through the owning modules' services. Add its key to `REPORT_KEYS` in `packages/shared/src/schemas/reports.ts` and its name to `report.name_<key>` in the strings.
- `ReportsService` narrows every report to the caller's scope and the filters, for one month on the tenant's clock, and resolves headings and coded values in the requested `locale` with the tenant's terms: cells hold words, numbers, ISO dates and moments.
- Exports run on the `exports` queue (`ExportsService.run`), as the requester may see at that moment, and are kept for 7 days (`EXPORT_KEEP_DAYS`). Write files only through `toCsv()` and `toXlsx()` in `files.ts`, which keep text from starting a formula (`neutraliseFormula` in `@thelamp/shared`). Only the requester reads an export, every request and download is audited, and BullMQ job IDs never contain `:`.

- The web Home reads `GET /v1/dashboard` (`DashboardService` in the reports module, with `PerformanceService.dashboard()` for tiles, trend and leaderboard). Draw charts only through `Chart` in `apps/web/src/charts/chart.tsx`, which takes colours from the tokens with `token()`, follows the theme, stops motion under reduced motion, and keeps a Show the numbers table beside every chart. Register any ECharts part a chart needs in `echarts.use()` there. Status series use the status `-solid` tokens; pending is hatched as well as coloured.

## Approval chains and the inbox (decisions D74 and D76)

- Chains live in `apps/api/src/modules/workflow`: `ChainsService` keeps each request type's chain as versions (`cell.workflow_definitions`) and the fallback role; a request records the version that routed it. A type without a chain goes to the requester's manager (D38).
- Start a request with `ApprovalsService.request(tx, tenantId, requesterId, type, requestId, actor, { accountId, facts })` in the transaction that makes it: `accountId` for `account_slot` steps, `facts` keyed as `REQUEST_FACTS` in `@thelamp/forms` for step conditions. A new request type registers with `RequestTypes` (its `decided` also receives `cancelled`, applied as a rejection) and adds its facts to `REQUEST_FACTS`.
- Routing is `routeRequest()` in `@thelamp/shared` (BR-31); the resolvers are `Approvers` (`People.ancestors`, `Scopes.holdersReaching`, the accounts' slot seam). Moving to a later step, escalating and reminding publish `approval.waiting`; reminders and escalations run every 15 minutes (`approvals.keep_time`).
- Step schemas (`Approver`, `WorkflowStep`) are the form engine's, in `@thelamp/forms`; templates re-export them. The web edits chains at Settings → Approval chains with the form builder's `ConditionEditor`.
- The inbox (decision D76): `GET /v1/approvals/inbox` (with `counts` by type), `/mine` and `POST /v1/approvals/decisions` for bulk approval. A type opts into bulk with `bulk: true` on its registration; each item runs in `Database.savepoint()`, so one refusal leaves the rest approved. The web inbox is `apps/web/src/approvals/` (chains drawn with `ApprovalSteps`); on the phone managers decide in the Team tab and `/approvals/<id>` (`src/approvals.ts`), online, one at a time.

## Tenant administration (decision D64)

- Settings are `TenantSettings`; the apps read them from the bundle through `BundleSettings`, which drops settings they don't know and fills missing ones with defaults, so settings may only ever be added. The display name is the directory's (`TenantDirectory.rename()`), the logo a `logo` media file behind `/v1/organisation/logo`.
- A tenant's accent comes only from `deriveAccent()` in `@thelamp/shared`, as `packages/design-tokens/tenant-theming.md` sets out: on the web through `applyBrand()` in `apps/web/src/brand.ts`, on the phone through `Look` (`src/look.tsx`) and `ThemeProvider`'s `accent`. Never hard-code a tenant colour.
- Modules: put a new module's permissions in `MODULE_PERMISSIONS` and its reports in `REPORT_MODULE` (`@thelamp/shared`). Switched off, IAM strips their permissions and the guard answers `MODULE_DISABLED`; mark a route whose permissions are Core's but which belongs to a module with `@InModule()`. Screens of a module read `settings.modulesOff` from the bundle to hide themselves.
- Configuration screens (decision D65) change configuration through the same checks as templates: `checkAccountTypes` for account types, `checkMetrics` and `checkScore` (`MetricsAdmin` in the performance module) for metrics and the score. Keys never change; a metric keeps its unit, a territory level its place. A metric change publishes `metrics.changed`, and `performance.recompute` rebuilds people's days from its `from` date. On the web, custom fields are edited with `CustomFieldsEditor` (`apps/web/src/settings/custom-fields-editor.tsx`) and conditions with `ConditionEditor` from the form builder.
- Configuration export and import (decision D66) use the template format: `ConfigurationService` in `apps/api/src/modules/configuration` exports through each module's reads and imports through each module's own create, update and publish, adding and updating but never removing. A new kind of configuration needs its section in the template schema, in the export, and an import step in `apply()`, with its entry in `CONFIGURATION_SECTIONS`. Configuration no module uses yet waits in `HeldConfiguration`.

## Offline sync (decision D40)

- Phones keep reference data through `GET /v1/sync/pull`. The module that owns a syncable table registers its entity with `SyncEntities`, as `apps/api/src/modules/iam/users.sync.ts` does: rows in `(row_version, id)` order, and a scope string that changes whenever rows can enter or leave the caller's reach without changing themselves. Add the entity to `SYNC_ENTITIES` with its row schema in `packages/shared/src/schemas/sync.ts`, and its local table, in a new local migration, in `packages/api-client/src/sync/local-schema.ts`. Raise the entity's `version` whenever its row changes shape.
- `row_version` is the writing transaction's ID, not a sequence number, so a cursor never passes a row that isn't committed yet. Rows removed for everyone go out as tombstones: call `SyncTombstones.record()` in the same transaction.
- On the phone, a capture writes its records and `Outbox.enqueue()` in one local transaction, and its kind gets a sender and a label in `apps/mobile/src/outbox-kinds.ts`. Senders call the API with the record's client-generated ID, so an upload sent twice is applied once.
- Forms are filled on the phone as `form_entries` through `FormEntries` (`@thelamp/api-client/sync`): a draft keeps the form version it started on and every change; submitting checks the values with `checkEntry` in `apps/mobile/src/forms/check.ts` and makes the entry read only (decision D46). The renderer is `FieldList` in `apps/mobile/src/forms/fields.tsx`; it shows fields as `checkFormValues` judges them, and problems in the reader's words through `issueText`.
- The sync engine runs on Node's built-in SQLite in tests (`@thelamp/api-client/node-sqlite`); `apps/api/test/device.int.test.ts` runs it as a simulated phone against the real API.

## Mobile app (decision D36)

- Build screens from `@thelamp/ui-mobile`, whose components take everything from the tokens; text goes through its `Text`, since React Native passes no colour down. Strings come from `useLanguage().t`, in English and Hindi.
- The app calls the API only through the client in `apps/mobile/src/client.ts`, and keeps the session and the device key in the secure store through `src/storage.ts`. Never put a token in plain storage or a log.
- Native modules follow the Expo SDK: add them with `pnpm exec expo install <package>` in `apps/mobile`, put any version `packages/ui-mobile` shares into the `mobile` catalog, and check with `pnpm exec expo install --check`.
- Signed-in screens live under `src/app/(app)`, behind the root layout's guards: tabs in `(tabs)`, and full-screen screens such as the upload queue beside it, above the tabs. Tabs follow components/BottomNav: at most five, filtered by permissions and modules.
- Components and screens are tested with Jest (jest-expo) and React Native Testing Library 14, whose `render` and `fireEvent` are async. `src/screens/sign-in.test.tsx` shows the fake client.
- Cloud builds (`eas build`) run on Kunal's Expo account (D34): ask first.

## Configuration and templates

- Tenant configuration (account types, forms, metrics, workflows, policies) is data, checked in two layers: a zod schema for its shape, then checks that every reference resolves and settings agree. Form schemas are in `packages/forms`, metric and score schemas in `packages/metrics`, the rest in `packages/templates/src/schema`.
- Checks return `ErrorDetail` lists (`{ path, issue }`, the spec 11.1 format) built with `issueAt`, so the API can return them as they are.
- Configuration refers to other configuration by key, never by ID. Keys match `^[a-z][a-z0-9_]{0,39}$` and never change once used.
- Configuration text is in English and Hindi. Names of countable things carry `one` and `other` forms.
- Money in configuration is a decimal string; compare amounts with `toMinorUnits`.
- Forms publish as versions through `FormsService` (decision D45): a form keeps its key, and a field keeps its type once any version used it. Check submitted values with `checkFormValues` from `@thelamp/forms`, on the server and in the apps alike. Compile a configured pattern with `compilePattern` (re2js, linear time), never `new RegExp`.
- Industry templates live at `packages/templates/<key>/template.json`; see its README. Raise a template's `version` with every change, and keep schema changes additive.

## Migrations

Migrations are append-only and backward compatible. They follow expand and contract: add, backfill in a job, switch reads, then remove the old structures in a later release. Never hold long locks on large tables: use `CREATE INDEX CONCURRENTLY` and batched backfills.

## Testing (spec 14.4)

- **Unit:** Vitest for business rules, the form engine and metrics; Jest with jest-expo for React Native components and screens.
- **Integration:** Testcontainers and supertest against real migrations and RLS.
- **Cross-tenant contract test:** `test/cross-tenant.int.test.ts`, generated from the route registry; it fails for a route without a fixture. A new route's fixture has tenant B try tenant A's IDs: `sameAsNowhere()` for anything that takes an ID, `holdsNothingOfA()` for reads, and every row of A's is compared after each request.
- **End to end:** Playwright (with axe) for the web apps; Maestro for mobile, run by hand in CI or locally with `apps/mobile/.maestro/run.sh` (decisions D68 and D75). Flows select by the screen's English text and run against a fresh tenant from `e2e:fixtures`, never seeded people; sign-in codes come from Mailpit (`OTP_PROVIDER=mailpit`).
- **Load:** k6 in `tools/k6`, with spec 3.2's targets as thresholds; sessions come from `load:fixtures`, one person per virtual user.
- **Merging (decision D75):** GitHub's free minutes cover only the quick checks, so pull requests run formatting, types, lint and unit tests there; integration, end-to-end, the image and Terraform run on main after each merge. Before merging, run `pnpm verify` locally and note its result and commit in the pull request. A pull request merges only with its quick checks green and `pnpm verify` passing.

## Deployment (decision D67)

- One image, `apps/api/Dockerfile`, runs every cell process: the API by default, and `node dist/worker.mjs`, `dist/scheduler.mjs`, `dist/migrate.mjs` and `dist/bootstrap.mjs`. Build it from the root: `docker build -f apps/api/Dockerfile .`. The API bundles the workspace packages, so they stay in its `devDependencies`; a new npm package the API imports at runtime goes in `dependencies`.
- `infra/` holds the Terraform: `environments/staging` and `environments/production` compose `modules/environment` (network, ECR, certificates, the cell, the web portal, the GitHub deploy role). Change sizes in an environment, not in the modules. CI runs `terraform fmt -check` and `validate`; nothing is applied from CI.
- A new setting reaches AWS in `modules/cell/services.tf`: a plain value in the processes' environment, or a key of the cell's secret in `secret_keys`. Production refuses console and memory providers, so a new provider needs its real sender before it can be switched on.
- `.github/workflows/deploy.yml` deploys main after CI, staging then production, once `DEPLOY_ENABLED` is true. Setting up, deploying, rolling back and a failed migration: `docs/runbooks/`.
- SMS in India goes through DLT templates only: one-time codes and SMS notifications are sent by MSG91 in templates (`MSG91_OTP_TEMPLATE_ID`, `MSG91_SMS_TEMPLATES` by event and language), never as free text. A new event that should reach people by SMS needs its approved template added there.

## The demo (decision D70)

- The demo runs the whole product on one EC2 instance in Kunal's AWS sandbox, on the Free plan's credit: Docker Compose (`infra/demo/compose.yaml`) with Caddy at `app.thelamp.in`; Terraform in `infra/environments/demo`, with local state. It isn't staging; nothing carries over to the company's accounts.
- A demo cell is `CELL_PURPOSE=demo`: production code with `OTP_PROVIDER=none` and console senders for SMS and email (numbers masked). A live cell refuses both.
- People sign in to demo tenants (`pnpm provision --demo`, the `demo` flag in `directory.tenants`) with fixed codes from `DEMO_CODES`. A code works only while every tenant of its number is a demo tenant; keep the codes in `terraform.tfvars`, never in the repository.
- `src/demo-content.ts` (`demo:content`, `demo.sh content`) fills a new demo tenant with weeks of work through the services, under the simulated clock of `src/demo/clock.ts`; storage signs with real time. Keep it reading the tenant's configuration, never a template's keys.
- A new setting the demo needs goes in `local.settings` in `infra/environments/demo/main.tf`, as well as the cell's `modules/cell/services.tf`.

## Design system

- The look is **Field** (decision D72): Forest accent and harvest gold (`brand-forest`, `brand-gold`, `on-brand` are the product's own, never a tenant's), Mukta for Latin and Devanagari, sturdy corners (buttons `radius-md`), and the pin-and-flame mark. The portal's shell uses `ks-rail`, `ks-appbar` and `ks-auth` from `bundle.css`.
- `packages/design-tokens` holds the design system. `tokens.json` is the source of truth, and `tokens.css` and `tokens.ts` are generated from it. The package also holds the brand book (`README.md`), the component guides, the reference `bundle.css` and the logos.
- UI code takes colours, spacing, radii, type and motion from the tokens, never hex values or hand-picked timings. Motion honours reduced motion (`prefers-reduced-motion`, and `data-motion` on the root).
- The same system is published as a claude.ai Design System artifact: https://claude.ai/artifact/REeP6ZXP72DN9kfhVHbPT3. Make every design-system change in both places in the same piece of work.
- Run `pnpm tokens` whenever `tokens.json` changes. The token tests fail when a generated file is stale, a themed token misses a theme, or a colour pair named in the usage notes falls under its contrast floor.
- Prettier ignores `packages/design-tokens/` and all markdown, so the mirrored files stay byte-identical to the artifact.
