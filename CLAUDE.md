# Kshetra

A multi-tenant field-force SaaS: an Android-first mobile app, a tenant web portal, a vendor console and a public API. [docs/Kshetra.md](docs/Kshetra.md) is the source of truth for scope and behaviour. If code and spec disagree, raise it with the owner (Kunal) and change one of them deliberately. Decisions are logged in [docs/decisions.md](docs/decisions.md). Every service the project uses, local and production, is listed in [docs/services.md](docs/services.md).

## Status

Phase 1 (the field core) is in progress, and phase 0 is complete. Start a new phase only with Kunal's explicit go-ahead. [docs/progress.md](docs/progress.md) tracks every step: its status, its pull request, and the open items waiting on the owner. Update it in the same pull request as each step.

Build in the phase order of spec section 15. Meet each phase's exit criteria, tests included, before the next phase starts. Inside a phase, take one capability at a time through every layer: schema, shared rules, API, web, mobile, tests.

## Commands

| Command | What it does | Available |
|---|---|---|
| `pnpm install` | installs the workspace (pnpm 12, Node 24) | now |
| `pnpm typecheck`, `pnpm lint`, `pnpm test` | static checks and unit tests, through Turborepo | now |
| `pnpm format`, `pnpm format:check` | Prettier | now |
| `docker compose up -d` | starts the local services | now |
| `pnpm dev` | runs the API on http://127.0.0.1:3000 with its worker and scheduler, the web portal on http://127.0.0.1:5173 (which passes `/auth` and `/v1` through to the API), and the field app's Expo dev server | now |
| `pnpm --filter @kshetra/mobile go` | serves the field app to Expo Go on a phone on the same Wi-Fi; run the API with `HOST=0.0.0.0 pnpm dev`, or set `HOST` in `.env`. Turborepo passes only the variables `turbo.json` lists to a task (`HOST` and `CORS_ORIGINS` for `dev`), so add any other you need there | now |
| `pnpm --filter @kshetra/mobile web` | runs the field app in a browser, standing in for an Android phone; development only, so add http://localhost:8081 to `CORS_ORIGINS` | now |
| `pnpm test:int` | integration tests against PostgreSQL in Docker, through Testcontainers (Docker must be running) | now |
| `pnpm test:e2e` | Playwright tests of the web portal, with axe, against a mocked API. Install the browser once with `pnpm --filter @kshetra/web exec playwright install chromium`. | now |
| `pnpm tokens` | regenerates `tokens.css` and `tokens.ts` in `packages/design-tokens` from `tokens.json` | now |
| `pnpm db:bootstrap` | creates the database roles; refuses anything but a local or CI database | now |
| `pnpm db:migrate` | applies migrations as the `migrator` role | now |
| `pnpm --filter @kshetra/api db:generate` | writes a migration for a schema change | now |
| `pnpm --filter @kshetra/templates schema` | regenerates `packages/templates/schema.json` after a template schema change | now |
| `pnpm db:seed` | seeds two fictional tenants and refuses non-local databases; running it again changes nothing | now |
| `pnpm provision --name … --slug … --template … --admin-name … --admin-phone …` | creates a tenant from a template, with its first admin | now |
| `pnpm openapi` | regenerates `apps/api/openapi.json` from the route registry; a test fails while it is out of date | now |

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

- **Naming:** snake_case in the database, camelCase in TypeScript, kebab-case file names, kebab-case plural nouns in API paths. Every product name, package scope and identifier derives from one `PRODUCT_SLUG` value (working name: `kshetra`).
- **No industry words in code.** Distributor, retailer, farmer, doctor, beat, outlet, liquidation and similar terms belong in industry templates, seed data and translation strings. Code speaks of accounts, account types, forms, submissions, metrics, routes and plan items.
- **Tenancy:** every tenant-owned table has `tenant_id` and a row-level security policy from its first migration, indexes led by `tenant_id`, and an entry in the cross-tenant test fixtures. The cross-tenant contract test covers every endpoint.
- **Business rules** (spec section 7) are pure functions in `packages/shared`, tested with the Appendix D fixtures. The server is authoritative; clients call the same functions only to preview.
- **Schemas:** each request and response has one zod schema in `packages/shared/src/schemas/<module>`. Controllers never define ad hoc types. The one exception: a request or response that carries form-engine configuration, such as user fields, keeps its schema in `packages/forms` beside `CustomField`, because `@kshetra/shared` can't depend on that package (decision D41).
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
- **Errors:** throw `AppError` from `@kshetra/shared` with a spec 11.4 code; the global filter writes the spec 11.1 format.

## Sign-in and access (decisions D29 and D30)

- Sign-in lives in `apps/api/src/modules/directory`. Only that module touches the directory schema, through `DirectoryDatabase` as `directory_app`. The directory and the cell reach each other only through the seams in `apps/api/src/platform/planes.ts`: the cell admits each sign-in and binds the phone, and tells the directory whenever a user's sign-in facts change.
- Every route declares who may call it: `@Public()` (health checks and sign-in only), `@SignedIn()`, `@Requires(...)` or `@RequiresAny(...)`, with permissions from spec Appendix E. A route that declares nothing is refused, and `test/iam.int.test.ts` fails. Handlers read the caller with `@CurrentAccess()`.
- Every route also declares what it takes and gives with `@Contract(...)`: a summary, its group, and the shared zod schemas of its path parameters, query, body and answer (decision D37). The route registry (`src/platform/routes.ts`) reads both, and the OpenAPI document and the cross-tenant contract test are built from it. After changing a route, run `pnpm openapi`.
- The global `AuthGuard` checks the token. IAM then checks, on every request, that the tenant, user and device are still active at the token's auth revision.
- Filter records by the caller's data scope with `Scopes` from the IAM module. A record outside the scope answers `OUT_OF_SCOPE`; another tenant's record answers `NOT_FOUND`.
- Nobody gives access they don't hold (`canGrant` in `@kshetra/shared`), and nobody acts on their own record where a rule forbids it, such as resetting their own device.
- Never log phone numbers, one-time codes or tokens. A message that must name a number uses `maskPhone()`.
- Integration tests use `test/support.ts`: `startApp()`, `testConfig()`, and `World`. `World` makes tenants from a template and users through the app's own services, and signs people in on the web, or on a phone with `newDevice()`. Fresh numbers and addresses keep tests from sharing rate limits. `OTP_PROVIDER=memory` keeps codes for tests.

## Configuration bundle and text (decision D31)

- Strings live in `packages/i18n/src/messages/en.ts` and `hi.ts` under stable keys. Add both languages in the same change. A message names a term through a placeholder such as `{term.account:lower}`, never as a word; plural messages carry `one` and `other`.
- Format numbers, money and dates with `formatNumber`, `formatMoney`, `formatDate` and `formatDateTime` from `@kshetra/i18n`. A tenant's "today" is `todayIn(settings.timezone)` from `@kshetra/shared`.
- Tenant settings are `TenantSettings` in `@kshetra/shared`, with `SETTING_DEFAULTS`; read them with `TenantConfigService.settings()`. A new setting needs a default, and settings are never renamed.
- Anything the config bundle holds moves the config version: call `TenantConfigService.touch()` in the same transaction as the change.

## Audit and events (decision D32)

- Every change writes an audit entry with `AuditLog.record()` in the same transaction: the action from `AUDIT_ACTIONS` in `@kshetra/shared`, the target, and the values before and after. `userActor(access)` names the caller; `SYSTEM_ACTOR` names provisioning.
- Publish a domain event with `Outbox.publish()` in the same transaction as the change; it is delivered once the transaction commits, and retried by the relay if a consumer fails. Add event types and payloads to `packages/shared/src/events.ts`.
- Consumers registered with `Outbox.consume()` must be idempotent: delivery is at least once.
- Work that must wait for a commit goes through `Database.afterCommit()`.

## Web portal (decision D35)

- The web never stores a token. The refresh token lives in the directory's httpOnly cookie and the access token in memory, so a reload restores the session with `client.restore()`. Never put a token in `localStorage`, `sessionStorage` or a URL.
- Web code calls the API only through `@kshetra/api-client`, which refreshes tokens and turns error responses into `ApiError` with a spec 11.4 code. Show errors with `errorMessage()` from `apps/web/src/i18n.tsx`.
- Build screens from `@kshetra/ui-web` and the design system's `ks-*` classes; Tailwind is for layout. Text comes from `useLanguage().t`, in English and Hindi.
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
- Match names in files with `matchName` from `@kshetra/shared` (BR-42); it never guesses between two close names.

## Accounts and approvals (decision D43)

- Who sees an account is `AccountsService.reach()`: today's slot holders within the caller's scope, their territories when the scope covers territory, and what they proposed. List, read and sync through it.
- Account types carry form-engine fields, so their schemas and the full `ConfigBundle` live in `@kshetra/forms`; `@kshetra/shared` has `CoreConfigBundle`. When the bundle gains a part, raise `BUNDLE_SHAPE` in the config-bundle controller so phones fetch it again.
- A request that needs approval registers its type with `RequestTypes` in the owning module and starts with `ApprovalsService.request()` in the same transaction; its `decided()` applies the outcome in the deciding transaction.
- Records made on a phone carry their own IDs: wrap the create in `idempotent()` keyed by `<kind>:<id>`, so a resend replays and a changed body is `IDEMPOTENCY_CONFLICT`.
- Points are `geography(Point, 4326)`: write with `pointSql()`, read with `pointOf()` from `src/platform/geo.ts`.

## Photos (decision D44)

- Photos never pass through the API: the phone uploads straight to storage through `POST /v1/media/presign`'s link, then confirms. Use the `media.upload` outbox kind and `preparePhoto()` and `queuePhoto()` in `apps/mobile/src/photos.ts`; the camera screen (`/camera?kind=&request=`) does both and hands the IDs back through `capture-results.ts`.
- Records that use photos attach them by ID in the transaction that creates the record, after checking their owner and status (spec 12.2, step 5). Read them only through `GET /v1/media/{id}/url`.
- In tests the object store is in memory; `MemoryObjectStore.receive(url, bytes)` stands in for the phone's upload and refuses bytes that weren't signed for.

## Shifts and tracking (decision D47)

- Shifts, points, trails and attendance days live in `apps/api/src/modules/field`. The rules are pure functions in `packages/shared/src/tracking.ts`: `pointRejection()` (BR-36), `punchFixIssue()`, `clockSkewed()` (BR-44), `onDutyMs()`, `compactTrail()` and `dayStatus()` (BR-23 as shifts decide it).
- `cell.location_points` is range-partitioned by day with pg_partman, so Drizzle can't declare it: migration 0018 creates it partitioned. `cell.maintain_location_partitions()` makes the coming days' partitions and gives each one the tenant-isolation policy; the scheduler runs it four times a day. Query points through the parent, always with a `captured_at` range, so only the shift's days are read. Old partitions stay until the archive lands (step 17).
- A shift's start and end publish `shift.started` and `shift.ended`; their consumers keep the person's attendance day and compact the trail. The nightly job (`field.nightly`, 00:30 on the tenant's clock) closes forgotten shifts, compacts what is left and keeps everyone's day just gone.
- Live positions go out on Redis (`positions:<tenantId>`) after the ingest commits, for the live map (M17).
- On the phone (decision D48), `Tracking` in `@kshetra/api-client/sync` keeps the open shift and buffers points, dropping what the server would refuse; points upload only once their shift's punch-in has left the outbox. Punches go through `punchIn()`, `punchOut()`, `pauseShift()` and `resumeShift()` in `apps/mobile/src/tracking.ts`, which save on the phone and queue in one transaction. The background task is defined in `src/background.ts`, imported first by the root layout. Tracking starts only from a punch-in, a resume or "Record again", never by itself (BR-37). Background location needs a development build (`eas build --profile development`, on Kunal's account); Expo Go can't run it.

## Visits and submissions (decision D49)

- Judge any record captured in the field with `evidenceIssues`, `photoIssues` and `geofenceResult` from `@kshetra/shared` (BR-32, BR-33), against the shift `ShiftsService.at()` finds for its capture time; `refuseEvidence()` in `apps/api/src/modules/field/evidence.ts` answers with the first problem's code and lists them all.
- An account a record is made at comes from `AccountsService.forCapture()`: seen by the caller, with its status, type, distance from its verified location, radius and geofence policy.
- Records attach their photos with `PhotosService.forRecord()` and `attach()` in the creating transaction. Submissions are immutable; what reviewers should see goes in `flags`.
- Work repeated for each tenant on an interval uses `Schedules.everyForTenants()`.
- On the phone (decision D50), `Visits` in `@kshetra/api-client/sync` keeps the open visit; check in and out through `checkIn()` and `checkOut()`, and submit form entries through `submitEntry()`, all in `apps/mobile/src/visits.ts`, which save on the phone and queue in one transaction. `geofenceAt()` previews the server's geofence judgement. A submitted entry waits while its upload is in the outbox.

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
- Targets and account plans (decision D55) live in the same module: `TargetsService` and `AccountPlansService`. They refer to metrics by key; the tenant's metric definitions are stored from its template by `MetricsService.applyTemplate()` and read with `targetable()`. Judge a value with `targetValueIssue()` and an unlock with `unlockRefusal()` from `@kshetra/shared`. Nobody sets their own targets; a locked set changes only after an unlock, which publishes `target.unlocked` as a lock publishes `target.locked`.

## Metrics and performance (decision D56)

- The metric engine lives in `apps/api/src/modules/performance`; definitions stay in `modules/metrics` (`MetricsService.definitions()`, `score()`). `MetricsEngine.recompute(tx, tenantId, userId, date)` rebuilds one person's day from the records the owning modules' `forMetrics()` methods return, through `calculateDayFacts()` in `@kshetra/metrics`. Recomputing is idempotent.
- Anything that changes a person's day recomputes it: the consumers in `performance.upkeep.ts` follow `submission.created`, `submission.reviewed`, `visit.ended` and `plan_item.status_changed`. A new source of metric values needs its event consumed there and its calculator in `calculate.ts`, added to `COMPUTED_SOURCES`.
- Values belong to the capturing person and the capture's date on the tenant's clock (BR-03): filter moments with `onLocalDate()` from `src/platform/local-day.ts`.
- Scores and ranks are `scoreOf()` and `rankByScore()` from `@kshetra/shared` (BR-06, BR-07), computed on read by `PerformanceService` from locked targets; ranking groups are designations marked ranked (D8).
- The web shows a metric with `MetricTile` in `apps/web/src/performance/shared.tsx`, on the design system's `KpiTile` from `@kshetra/ui-web`, and formats values by unit with `useFigure()`.

## Offline sync (decision D40)

- Phones keep reference data through `GET /v1/sync/pull`. The module that owns a syncable table registers its entity with `SyncEntities`, as `apps/api/src/modules/iam/users.sync.ts` does: rows in `(row_version, id)` order, and a scope string that changes whenever rows can enter or leave the caller's reach without changing themselves. Add the entity to `SYNC_ENTITIES` with its row schema in `packages/shared/src/schemas/sync.ts`, and its local table, in a new local migration, in `packages/api-client/src/sync/local-schema.ts`. Raise the entity's `version` whenever its row changes shape.
- `row_version` is the writing transaction's ID, not a sequence number, so a cursor never passes a row that isn't committed yet. Rows removed for everyone go out as tombstones: call `SyncTombstones.record()` in the same transaction.
- On the phone, a capture writes its records and `Outbox.enqueue()` in one local transaction, and its kind gets a sender and a label in `apps/mobile/src/outbox-kinds.ts`. Senders call the API with the record's client-generated ID, so an upload sent twice is applied once.
- Forms are filled on the phone as `form_entries` through `FormEntries` (`@kshetra/api-client/sync`): a draft keeps the form version it started on and every change; submitting checks the values with `checkEntry` in `apps/mobile/src/forms/check.ts` and makes the entry read only (decision D46). The renderer is `FieldList` in `apps/mobile/src/forms/fields.tsx`; it shows fields as `checkFormValues` judges them, and problems in the reader's words through `issueText`.
- The sync engine runs on Node's built-in SQLite in tests (`@kshetra/api-client/node-sqlite`); `apps/api/test/device.int.test.ts` runs it as a simulated phone against the real API.

## Mobile app (decision D36)

- Build screens from `@kshetra/ui-mobile`, whose components take everything from the tokens; text goes through its `Text`, since React Native passes no colour down. Strings come from `useLanguage().t`, in English and Hindi.
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
- Forms publish as versions through `FormsService` (decision D45): a form keeps its key, and a field keeps its type once any version used it. Check submitted values with `checkFormValues` from `@kshetra/forms`, on the server and in the apps alike. Compile a configured pattern with `compilePattern` (re2js, linear time), never `new RegExp`.
- Industry templates live at `packages/templates/<key>/template.json`; see its README. Raise a template's `version` with every change, and keep schema changes additive.

## Migrations

Migrations are append-only and backward compatible. They follow expand and contract: add, backfill in a job, switch reads, then remove the old structures in a later release. Never hold long locks on large tables: use `CREATE INDEX CONCURRENTLY` and batched backfills.

## Testing (spec 14.4)

- **Unit:** Vitest for business rules, the form engine and metrics; Jest with jest-expo for React Native components and screens.
- **Integration:** Testcontainers and supertest against real migrations and RLS.
- **Cross-tenant contract test:** `test/cross-tenant.int.test.ts`, generated from the route registry; it fails for a route without a fixture. A new route's fixture has tenant B try tenant A's IDs: `sameAsNowhere()` for anything that takes an ID, `holdsNothingOfA()` for reads, and every row of A's is compared after each request.
- **End to end:** Playwright (with axe) for the web apps, Maestro for mobile.
- **Load:** k6.
- **Merging:** a pull request merges only with typecheck, lint, unit, integration and end-to-end tests green.

## Design system

- `packages/design-tokens` holds the design system. `tokens.json` is the source of truth, and `tokens.css` and `tokens.ts` are generated from it. The package also holds the brand book (`README.md`), the component guides, the reference `bundle.css` and the logos.
- UI code takes colours, spacing, radii, type and motion from the tokens, never hex values or hand-picked timings. Motion honours reduced motion (`prefers-reduced-motion`, and `data-motion` on the root).
- The same system is published as a claude.ai Design System artifact: https://claude.ai/artifact/REeP6ZXP72DN9kfhVHbPT3. Make every design-system change in both places in the same piece of work.
- Run `pnpm tokens` whenever `tokens.json` changes. The token tests fail when a generated file is stale, a themed token misses a theme, or a colour pair named in the usage notes falls under its contrast floor.
- Prettier ignores `packages/design-tokens/` and all markdown, so the mirrored files stay byte-identical to the artifact.
