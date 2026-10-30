# The Lamp

A multi-tenant field-force SaaS: an Android-first mobile app, a tenant web portal, a vendor console and a public API. [docs/spec.md](docs/spec.md) is the source of truth for scope and behaviour. If code and spec disagree, raise it with the owner (Kunal) and change one of them deliberately. Decisions are logged in [docs/decisions.md](docs/decisions.md). Every service the project uses, local and production, is listed in [docs/services.md](docs/services.md).

## Status

Phase 4 (growth) starts by Kunal's decision of 2026-10-30 (D107); its plan is shown to him before anything is built. Phase 3 (SaaS readiness, D87) and phase 2 (commerce and people, D73) are built, and phase 1 but for its pilot week; their real-world exit checks (the pilot week, real invoices, the penetration test, the stores' approval) wait on the company's accounts and stay in the open items. Phase 0 is complete. Phase U, the UI revamp to the approved prototype (decision D104, [its plan](docs/superpowers/plans/2026-10-27-ui-revamp.md)), is complete; new screens still meet [docs/ui-acceptance.md](docs/ui-acceptance.md). Start a new phase only with Kunal's explicit go-ahead. [docs/progress.md](docs/progress.md) tracks every step: its status, its pull request, and the open items waiting on the owner. Update it in the same pull request as each step.

Build in the phase order of spec section 15. Meet each phase's exit criteria, tests included, before the next phase starts. Inside a phase, take one capability at a time through every layer: schema, shared rules, API, web, mobile, tests.

## Commands

| Command | What it does | Available |
|---|---|---|
| `pnpm install` | installs the workspace (pnpm 12, Node 24) | now |
| `pnpm typecheck`, `pnpm lint`, `pnpm test` | static checks and unit tests, through Turborepo | now |
| `pnpm format`, `pnpm format:check` | Prettier | now |
| `docker compose up -d` | starts the local services | now |
| `pnpm dev` | runs the API on http://127.0.0.1:3000 with its worker and scheduler, the web portal on http://127.0.0.1:5173 (which passes `/auth` and `/v1` through to the API), the platform console on http://127.0.0.1:5174 (which passes `/platform` through), and the field app's Expo dev server | now |
| `pnpm --filter @thelamp/mobile go` | serves the field app to Expo Go on a phone on the same Wi-Fi; run the API with `HOST=0.0.0.0 pnpm dev`, or set `HOST` in `.env`. Turborepo passes only the variables `turbo.json` lists to a task (`HOST` and `CORS_ORIGINS` for `dev`), so add any other you need there | now |
| `pnpm --filter @thelamp/api load:fixtures --users N` then `k6 run tools/k6/<script>.js` | load tests against the local API (decision D68, `tools/k6/README.md`); make new fixtures before each run | now |
| `pnpm --filter @thelamp/api e2e:fixtures` then `apps/mobile/.maestro/run.sh <apk>` | the field app's Maestro flows on an emulator (decision D68, `apps/mobile/.maestro/README.md`) | now |
| `pnpm --filter @thelamp/mobile web` | runs the field app in a browser, standing in for an Android phone; development only, so add http://localhost:8081 to `CORS_ORIGINS` | now |
| `pnpm test:int` | integration tests against PostgreSQL in Docker, through Testcontainers (Docker must be running) | now |
| `pnpm test:e2e` | Playwright tests of the web portal, with axe, against a mocked API. Install the browser once with `pnpm --filter @thelamp/web exec playwright install chromium`. | now |
| `pnpm verify` | the full check before a merge (decision D75): formatting, types, lint, unit, phone, integration and web end-to-end tests, Terraform; `--image` builds the container image too. Docker must be running | now |
| `pnpm --filter @thelamp/ui-compare compare --phone …` | screenshots each prototype artboard beside the portal page that answers to it, in Light and Dark at 1440 and 390 px, with a gallery page (phase U, decision D104, `tools/ui-compare/README.md`) | now |
| `pnpm tokens` | regenerates `tokens.css` and `tokens.ts` in `packages/design-tokens` from `tokens.json` | now |
| `infra/scripts/demo.sh apply\|deploy\|provision\|pause\|resume\|status` | the demo on one EC2 instance in the AWS sandbox (decision D70, `infra/demo/README.md`); signed in with `aws login --profile thelamp-sandbox` | now |
| `pnpm rename --name … [--slug …]` | renames the product across the repository from `product.json` (`tools/rename/README.md`); the slug and app ID only until launch | now |
| `pnpm db:bootstrap` | creates the database roles; refuses anything but a local or CI database | now |
| `pnpm db:migrate` | applies migrations as the `migrator` role | now |
| `pnpm --filter @thelamp/api db:generate` | writes a migration for a schema change | now |
| `pnpm --filter @thelamp/templates schema` | regenerates `packages/templates/schema.json` after a template schema change | now |
| `pnpm db:seed` | seeds two fictional tenants and refuses non-local databases; running it again changes nothing | now |
| `pnpm invite-staff --email … --name … [--role …]` | invites a vendor staff member to the platform console and prints their one-time setup link (decision D88); the first platform admin comes this way | now |
| `pnpm provision --name … --slug … --template … --admin-name … --admin-phone …` | creates a tenant from a template, with its first admin; `--file <path>` instead of `--template` starts it from another tenant's exported configuration; `--logo` and `--brand-colour` set its branding as Settings would; `--demo` makes a demo tenant (D70) | now |
| `pnpm reseal` | seals every secret kept in a column again under the current `COLUMN_KEY`, after a rotation with the old key as `COLUMN_KEY_PREVIOUS` (decision D101, docs/runbooks/secret-rotation.md) | now |
| `pnpm archive verify --file … --public-key …`, `pnpm archive public-key` | checks a tenant's data export against the key that signed it, or prints a cell's public key from `ARCHIVE_SIGNING_KEY` (decision D95) | now |
| `pnpm tenant-move register-cell\|start\|export\|import\|finish\|purge\|cancel` | moves a tenant between cells, a step at a time on the cell each concerns (decision D95, docs/runbooks/moving-a-tenant.md) | now |
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

The seed prints who can sign in. Each person belongs to one tenant (decision D103).

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
- **Reads on the replica (decision D98):** reports, the dashboard and export rows use `Database.read()`: the replica when the cell has one, read only, one snapshot, each statement stopped after `REPORT_STATEMENT_TIMEOUT_MS` (exports pass `EXPORT_STATEMENT_TIMEOUT_MS`), answering `REPORT_TIMEOUT`. A list route API clients read in bulk takes `@FromReplica()` (`src/platform/replica.ts`), which moves an API client's `forTenant` calls there; mark only routes that never write.
- **New tenant tables:** put them in the `cell` schema with `tenant_id`, `.enableRLS()` and the `isolation()` policy, as `apps/api/src/db/schema/iam.ts` shows. `test/database.int.test.ts` fails for any `cell` table without them. Primary keys start with `tenant_id` (`(tenant_id, id)`), and references carry it too, so a row can't point into another tenant (decision D30). Syncable tables take `rowVersionColumn()` and a `next_row_version` trigger.
- **Schema changes:** edit the files in `apps/api/src/db/schema/`, run `db:generate`, and review the SQL before committing. Grants, triggers and anything else Drizzle can't express go in a migration made with `drizzle-kit generate --custom`.
- **Idempotent creates:** use `idempotent()` from `src/platform/idempotency.ts` (BR-46).
- **Errors:** throw `AppError` from `@thelamp/shared` with a spec 11.4 code; the global filter writes the spec 11.1 format.

## Sign-in and access (decisions D29 and D30)

- Sign-in lives in `apps/api/src/modules/directory`. Only that module and the console module touch the directory schema, through `DirectoryDatabase` as `directory_app`. The directory and the cell reach each other only through the seams in `apps/api/src/platform/planes.ts`: the cell admits each sign-in and binds the phone, and tells the directory whenever a user's sign-in facts change.
- Every route declares who may call it: `@Public()` (health checks and sign-in only), `@SignedIn()`, `@Requires(...)` or `@RequiresAny(...)`, with permissions from spec Appendix E. A route that declares nothing is refused, and `test/iam.int.test.ts` fails. Handlers read the caller with `@CurrentAccess()`.
- Every route also declares what it takes and gives with `@Contract(...)`: a summary, its group, and the shared zod schemas of its path parameters, query, body and answer (decision D37). The route registry (`src/platform/routes.ts`) reads both, and the OpenAPI document and the cross-tenant contract test are built from it. Every answer is cut to its route's response schema by `ResponseContract` (`src/platform/response-contract.ts`, decision D101): a field the schema doesn't declare never leaves, and an answer that doesn't fit fails outside production, so put every field clients need in the schema. After changing a route, run `pnpm openapi`.
- The global `AuthGuard` checks the token, and holds each person, support grant and staff member to `USER_REQUESTS_PER_MINUTE` (decision D101). IAM then checks, on every request, that the tenant, user and device are still active at the token's auth revision.
- Filter records by the caller's data scope with `Scopes` from the IAM module. A record outside the scope answers `OUT_OF_SCOPE`; another tenant's record answers `NOT_FOUND`.
- Nobody gives access they don't hold (`canGrant` in `@thelamp/shared`), and nobody acts on their own record where a rule forbids it, such as resetting their own device.
- Never log phone numbers, one-time codes or tokens. A message that must name a number uses `maskPhone()`.
- A person's number goes through `normaliseMobile()` (in India ten digits starting 6 to 9, never a landline) and a business contact's through `normalisePhone()`; an email through `EmailAddress` in a schema or `isEmail()` (decision D102). In the portal and the console, ask for them with `MobileField` and `EmailField` (`src/fields.tsx`), which explain a wrong value before anything is sent; on the phone, `TextField` with `prefix="+91"` and `mobileDigitsFrom()`.
- A person belongs to one organisation (decision D103): a number is active in one tenant at most, which the directory's `memberships_one_active_organisation` index guarantees, so a code signs straight in and nothing chooses or switches a tenant. Before a user gets a number or is made active again, `UsersService`, the users import and the provisioner ask `MembershipSync.activeElsewhere()` and refuse with `NUMBER_IN_USE` (`@thelamp/shared`), which never names the other tenant.
- The caller's address is `request.clientIp` (`@ClientIp()` in a handler), never `request.ip` or `@Ip()`: `clientAddress()` in `src/platform/client-address.ts` takes the load balancer's one hop (`TRUST_PROXY=1`) and, for CloudFront's requests carrying `ORIGIN_SECRET`, the viewer's address CloudFront writes (decision D101).
- Integration tests use `test/support.ts`: `startApp()`, `testConfig()`, and `World`. `World` makes tenants from a template and users through the app's own services, and signs people in on the web, or on a phone with `newDevice()`. Fresh numbers and addresses keep tests from sharing rate limits. `OTP_PROVIDER=memory` keeps codes for tests.

## Platform console (decision D88)

- The console's API is `apps/api/src/modules/console`, at `/platform/v1`. Vendor staff are `directory.platform_users`, not tenant users; their roles' permissions are `PLATFORM_ROLE_PERMISSIONS` in `@thelamp/shared`. Console routes declare `@ForStaff(...)` with platform permissions and read the caller with `@CurrentStaff()`; their tokens are for the platform audience, so tenant routes refuse them and console routes refuse tenant tokens.
- Staff sign in with email, password (scrypt, `src/platform/passwords.ts`) and a TOTP code (`totp.ts`, RFC 6238, the current step or the one before); the first admin is invited with `pnpm invite-staff`. Secrets kept in columns are sealed with `ColumnCipher` (`src/platform/column-cipher.ts`) under `COLUMN_KEY`, naming the column and row.
- Secrets kept in columns go through `ColumnCipher`, which seals as `v2:<key id>:…` and opens with `COLUMN_KEY` or `COLUMN_KEY_PREVIOUS`; a module that adds a sealed column adds it to its own `resealSecrets()`, which `pnpm reseal` calls (decision D101). Each process holds only its own secrets (`PROCESS_ROLE`, `ROLE_SECRETS` in `src/config.ts`, the same lists in `infra/modules/cell/services.tf`); a new secret goes in both.
- Staff sign-in judges each attempt on the staff row locked, so wrong tries count and codes are spent once; a locked account answers as wrong details do (decision D101). New passwords pass `passwordWordsIssue()` from `@thelamp/shared` and `BreachedPasswords` (`PASSWORD_BREACH_CHECK`: Have I Been Pwned's range API, `memory` in tests). Staff change theirs at `POST /platform/v1/me/password` (the console's Your account, `apps/console/src/pages/account.tsx`); admins reset a lost password or authenticator with `POST /platform/v1/staff/{id}/reset`, which returns a new setup link once.
- Every console change writes `PlatformAudit.record()` in its transaction. Tenants are created through `TenantProvisioner` with the console's own tenant ID.
- The console app is `apps/console`, built like the portal (`@thelamp/ui-web`, strings in English and Hindi, a Vitest test per screen and Playwright with axe). It calls the API only through `createConsoleClient` from `@thelamp/api-client`. In AWS it is the web module again at an environment's `console_domain`, passing `/platform/*` to the cell.

## Plans and usage (decision D89)

- Plans, entitlements and usage live in `apps/api/src/modules/billing` (directory plane). Cells read a tenant's entitlements through the `Entitlements` seam: `TenantConfigService.settings()` folds modules outside the plan into `modulesOff`, so module checks need nothing else. Without a plan, every module is open.
- People's active stretches are `cell.seat_intervals`, kept by `Seats` (IAM) in the transaction that changes a user's status; `Seats.assertRoom()` answers `SEAT_LIMIT` past the plan's limit. Billable seats are `billableSeats()` in `@thelamp/shared` (BR-45).
- Usage is metered hourly by `MeteringService` (`modules/metering`) and recorded through the `UsageRecorder` seam; API calls are counted by `ApiCalls` in the auth guard. A new metric goes in `USAGE_METRICS` and is measured there.
- The console shows plans at `/plans` (`apps/console/src/pages/plans.tsx`, `plan.tsx`) and a tenant's plan and usage on its page (`tenant-plan.tsx`). A new usage metric needs its column heading as `console.usage_<metric>`.

## Admin TOTP and SSO (decision D91)

- On the web, anyone whose role holds a `SECOND_FACTOR_PERMISSIONS` permission gives an authenticator code after the one-time code: `CellAdmission.admit()` says `secondFactor`, the directory answers `second_factor` with a ticket, and `SecondFactorService` (`apps/api/src/modules/directory/second-factor.service.ts`) sets the authenticator up and checks codes and recovery codes before `SessionsService.finish()` starts the session. Phones and demo tenants skip it. TOTP itself is `src/platform/totp.ts`, shared with the console.
- Single sign-on is `SsoService` (`apps/api/src/modules/directory/sso.service.ts`): connections at `/v1/sso`, the browser routes at `/auth/v1/sso/{slug}/…`, which answer with redirects (`redirect` in their `@Contract`) and set the web cookie through `WebCookie`. People are matched through the `PeopleEmails` seam, never created. A tenant that requires SSO refuses web OTP in `SessionsService` with `SSO_REQUIRED`. Integration tests run OIDC against `oauth2-mock-server` and sign SAML responses with `xml-crypto` and a certificate `openssl` makes on the spot.
- On the web, admins set the connection at Settings › Single sign-on (`apps/web/src/settings/sso-page.tsx`); a secret or certificate left blank keeps the saved one. The sign-in page's SSO step sends the browser away through `browser.go()` in `apps/web/src/pages/sign-in.tsx` (a seam tests replace), and shows the reason a sign-in came back with from `?sso=`, as `signin.sso_failed_<reason>`.
- Session limits are `sessionExpiresAt()` in `packages/shared/src/sessions.ts` (decision D101): web 12 hours idle and 7 days, SSO 12 hours, phones 30 and 90 days, counted from `refresh_tokens.family_started_at`. Anyone may set an authenticator up at `/security` (`AuthenticatorController`, `/auth/v1/authenticator`), and the web then asks for it. A phone's token never carries `SECOND_FACTOR_PERMISSIONS` (`IamAccess`). SSO sign-ins are bound to the starting browser by `ssoBinderCookie()`, SAML answers must match a request we sent (`SamlRequests`), and `providerUsedMfa()` decides whether our code is still asked for; that step reaches the sign-in page with the ticket in the fragment.
- Access tokens carry their session as `sid`; ending a refresh-token family marks it in `EndedSessions` (`src/platform/ended-sessions.ts`) once the ending commits, and the guard refuses its tokens (decision D101). People list and end their own sessions at `/auth/v1/sessions` (`OwnSessionsController`, shown on the web's `/security` by `apps/web/src/pages/own-sessions.tsx`); `WebCookie.handOver()` ends the session whose cookie a new sign-in replaces. `POST /v1/users/sign-out-everyone` signs everyone else in the tenant out.
- Changes to who signs in as whom need a fresh authenticator code (step-up, decision D101): mark such a route `@StepUp()`, or call `requireStepUp(access)` where only some changes need it, as `UsersService.update()` does for a phone or email. The session steps up at `POST /auth/v1/authenticator/step-up`; the web's client asks through `StepUpPrompt` and retries. In integration tests, `world.stepUp(phone, token)` gives the code. SSO domains count only once proved by a DNS TXT record (`directory.sso_domains`, `DomainRecords`, `MemoryDomainRecords.set()` in tests), and SSO people are bound by the provider's issuer and subject (`directory.sso_subjects`).
- The cell reaches authenticators only through the `SecondFactors` seam (`enrolled()`, `reset()`). In integration tests `World.signIn()` completes the step; use `world.secondFactor()` after a raw `verify()` that answers `second_factor`.

## Support access (decision D93)

- Vendor staff enter a tenant only under a grant: `SupportService` (`apps/api/src/modules/directory/support.service.ts`) keeps `directory.support_grants`, with the console's routes at `/platform/v1/support-grants`, the tenant admins' at `/v1/support-grants` (`settings.manage`), and the entry link at `/auth/v1/support/enter`. The rules are pure functions in `packages/shared/src/support.ts`: `supportStatus()`, `supportRequestIssue()`, `supportApprovalIssue()`, `supportPermissions()`.
- Vendor support is no user of the tenant: its token carries the grant (`sg`), `IamAccess` asks the `SupportGrants` seam on every request, and `Access.support` is set. Never look up the caller's user row without checking `access.support`; `GET /v1/me` answers for support without one. A read grant's writes answer `SUPPORT_READ_ONLY`; support never holds `billing.manage` and never decides on its own grant.
- `userActor(access)` records support as a `platform` actor with the grant's ID, so every audit entry made under a grant is marked. Changes made on the vendor's side reach the tenant's audit log and its admins through the `SupportNotices` seam.
- Screens: the console's `apps/console/src/pages/support.tsx` (the Support access page, the tenant page's `SupportCard`, and `portal.open()`, the seam that opens the portal in a new tab); the portal's Settings › Vendor support (`apps/web/src/settings/support-page.tsx`) and `SupportBanner` (`apps/web/src/layout/support-banner.tsx`), shown on every screen while `me.support` is set. `GET /v1/audit?supportGrantId=` lists what support did under a grant.
- Announcements are `AnnouncementsService` (`apps/api/src/modules/directory/announcements.service.ts`): the console writes them at `/platform/v1/announcements` (`platform.tenant.manage`), tenants read `GET /v1/announcements?surface=web|mobile`. The portal shows them through `Announcements` in `apps/web/src/layout/announcements.tsx`, the phone on Home through `useAnnouncements()` in `apps/mobile/src/announcements.ts`; dismissals stay in that browser or on that phone.
- Health per cell: the scheduler's `CellHealthReporter` (`apps/api/src/modules/scheduling/cell-health-reporter.ts`) reports each minute through the `CellHealthRecorder` seam to `CellHealthService` (directory), which the console reads at `/platform/v1/health`. Requests, errors and points are counted in Redis by `HealthCounters` (`src/platform/health-counters.ts`); counts across tenants come from `cell.health_facts()`, which returns only counts and ages. The limits are `healthIssues()` in `packages/shared/src/health.ts`. A new figure goes in `CellFigures` there and in the reporter.

## Public API (decision D94)

- API clients are `ApiClientsService` (`apps/api/src/modules/iam/api-clients.service.ts`), at `/v1/api-clients` (`api_client.manage`). Tokens come from `POST /auth/v1/oauth/token` (`oauth.controller.ts`, the client credentials grant) through the `ApiClientCredentials` seam; they carry the scopes in `scp`, and `Access.apiClient` is set. Scopes and the permissions they stand for are `API_SCOPES` in `packages/shared/src/api-clients.ts`; a new route that clients should reach either needs permissions some scope stands for, or, if it is open to anyone signed in, says so with `@ForApiClients(...scopes)`. Never open a person's own route to clients.
- Like vendor support, a client has no user row: check `access.apiClient` before reading the caller's user. `canGrant()` lets a client give any role but one that can change access.
- Bulk upserts are `BulkController` (`apps/api/src/modules/imports/bulk.controller.ts`) at `/v1/bulk/*`: JSON rows run through the target's own `ImportTargetSource` `check` and `commit`, all or nothing, under an `Idempotency-Key`. A new bulk route needs an import target first.
- External metric values are `ExternalMetricsImport` (`apps/api/src/modules/performance/external-values.ts`, permission `metric.record`): stored per metric, subject and day in `cell.external_metric_values`, credited to a person or to the account's first-slot holder that day (`AccountsService.creditedOn()`), and summed by the engine for `external` metrics.
- Each client's requests a minute are `limits.apiPerMinute` (`ApiClientLimits`), else `API_DEFAULT_PER_MINUTE`. The whole tenant's are `limits.requestsPerMinute` (`ApiClientLimits.tenant()`, in the auth guard for every caller; open without one, decision D98).
- `GET /v1/openapi.json` and `GET /v1/docs` (Scalar) document the API from the running routes; Scalar's browser bundle is copied into `dist/docs` at build, and the package stays a dev dependency.
- A call to an address a tenant names (a webhook receiver, an OIDC issuer) goes through `publicFetch` and `publicUrlIssue` in `src/platform/outbound.ts` (decision D101): HTTPS on 443 to a public address, connected to as checked. Never `fetch` one directly; the cell's tasks may only leave on 443 and 465.
- Webhooks live in `apps/api/src/modules/webhooks` (`webhook.manage`): `WebhooksService` keeps subscriptions with sealed secrets, fans each event out as one message a subscription (`fanOut()`, from the outbox consumer in `webhooks.upkeep.ts`) and tries messages on the `webhooks` queue (`deliver()`); `WebhookSender` checks addresses and signs as Standard Webhooks do. A subscribable event goes in `WEBHOOK_EVENTS` with its projection in `webhookData()` (`packages/shared/src/webhooks.ts`): IDs, keys and statuses, never personal details. Integration tests run no workers, so they call `deliver()` against a local receiver.
- The portal manages both at Settings › API clients (`apps/web/src/settings/api-clients-page.tsx`) and Webhooks (`webhooks-page.tsx`). Secrets are shown once through `SecretPanel` (`settings/secret.tsx`, with `Copyable`); the addresses integrators copy come from `apiAddresses()` in `apps/web/src/client.ts`.
- `cell.webhook_deliveries` is partitioned by month outside Drizzle (`src/db/webhook-deliveries.ts`, migration 0064), like the audit log: `cell.ensure_webhook_delivery_partitions()` runs daily and old partitions are dropped after three months.

## Data governance (decision D95)

- The tenant's data export lives in `apps/api/src/modules/governance`: `DataExportsService` (asking, the `exports` queue's `data_exports.run`, a day's download link, the hourly expiry) and `TenantArchive`, which writes every `cell` table with a `tenant_id` as JSON lines in one snapshot, then the files through `MediaService.forArchive()`, then the signed manifest. A new table joins on its own; a column holding a secret goes in `ARCHIVE_SECRET_COLUMNS`, and `test/data-exports.int.test.ts` fails for one that looks like a secret and isn't there.
- Archives are signed by `ArchiveSigner` (`src/platform/archive-signer.ts`) with the Ed25519 seed `ARCHIVE_SIGNING_KEY`; `verifyArchive()` checks one, as `pnpm archive verify` does. Large files go to storage from disk with `MediaService.storeFile()`.
- The portal's page is Settings › Data export (`apps/web/src/settings/data-export-page.tsx`); downloads leave through the `browser` seam (`apps/web/src/browser.ts`).
- Terminating a tenant is `TenantTermination` (`apps/api/src/modules/console/tenant-termination.ts`): the console terminates a suspended tenant, asks its cell for the final export through the `TenantArchives` seam, may undo it, and its hourly job erases the tenant 30 days on (`TenantArchives.erase()`, then the directory's memberships, sessions and people), keeping invoices and recording `tenant.deleted`. The console's card is `apps/console/src/pages/tenant-termination.tsx`.
- Personal data requests are `DataRequestsService` (`src/modules/governance/data-requests.service.ts`), at `/v1/me/data-requests` for the person and `/v1/data-requests` for admins (`settings.manage`). The rules are `dataRequestRaiseIssue()`, `dataRequestCloseIssue()`, `dataRequestDueOn()` and `dataRequestReminderDue()` in `packages/shared/src/data-requests.ts`. An access request's archive is `TenantArchive.write(…, 'personal', userId)`: every row referring to the person by any column, so a new table that refers to users joins on its own. Erasure calls each module's own part (`People.anonymise()`, `ShiftsService.erasePerson()`, `MediaService.eraseSelfies()`, `NotificationsService.erasePerson()`) and publishes `user.erased`, on which the directory forgets the membership (`MembershipSync.forget()`); a module that keeps new personal data about a person adds its part there. The portal's pages are `apps/web/src/settings/data-requests-page.tsx`; the phone's is `/data-requests` (`src/screens/my-data.tsx`, hooks in `src/data-requests.ts`), online only.
- The audit viewer is Settings › Audit log (`apps/web/src/settings/audit-log-page.tsx`, `audit.view`), on `GET /v1/audit` with `period`, `action`, `actorKind` and `actorId`; its export is the `audit_log` report with `auditAction`, `auditActorKind` and `userId`, which for the whole organisation also holds what the system, vendor staff and API clients did. A new kind of actor needs its name as `audit.actor_<kind>`.
- Moving a tenant between cells is `TenantMoves` (`src/modules/governance/tenant-moves.ts`) behind `pnpm tenant-move`, following docs/runbooks/moving-a-tenant.md. A moving tenant's requests carry `access.moving` and its writes answer `TENANT_MOVING`; a cell answers `TENANT_MOVED` for a tenant that lives elsewhere, and the API client refreshes on it. Sync cursors carry the cell; one from another cell resets. A new table moves with no change, as long as its references to other tables don't form a cycle (references within one table are fine).

## Billing (decision D90)

- Subscriptions, invoices, payments and dunning live in `apps/api/src/modules/billing` (directory plane): `TenantBillingService` (billing details, subscriptions, the mandate), `InvoicesService` (issuing in a gapless series, charging, recording payments), `DunningService` (BR-48) and `BillingCycle`, the hourly job on the vendor's clock (`BILLING_TIME_ZONE`) that issues, renews, trues up, charges, follows up and ends trials. Every step checks what was done before, so it may run any number of times. The rules are pure functions in `packages/shared/src/invoicing.ts`: `gstOn()`, `lineAmount()`, `trueUp()`, `dunning()`, `dunningNotices()`, `licenceState()`, `gstinIssue()`.
- Issue an invoice only through `InvoicesService.issue()` inside a directory transaction: it takes the next number from `invoice_sequences`, so a failed transaction gives its number back. Issued invoices never change; the PDF (`invoice-pdf.ts`, pdfkit) is drawn from the row on request.
- Billing reaches the cell through `SeatCounts` (seats for a period, BR-45) and `TenantContacts` (admins' emails); its emails go through `BillingNotices.send()` with a key, so each goes once, in the strings `billing.notice_*`.
- Read only (BR-48, BR-49): `Access.readOnly` makes the guard refuse writes with `TENANT_READ_ONLY`; mark a write a read-only tenant may still make with `@WhileReadOnly()`.
- `PAYMENT_PROVIDER` is `off` in production until Razorpay; `console` and `memory` stand in (`gateway.ts`). Seller details and dunning periods are `BillingSettings` (`platform_settings`); `ensureExample()` puts fictional ones in place for the seed and the demo, and a live cell refuses to invoice on them.
- Tenant admins see Settings › Billing (`apps/web/src/settings/billing-page.tsx`), on the billing module's `/v1/billing` routes (`portal-billing.controller.ts`, `billing.manage`), which read only the caller's own organisation. Writes there that must work while read only carry `@WhileReadOnly()`.
- The console's billing screens are `apps/console/src/pages/billing.tsx`, `billing-settings.tsx`, `invoice.tsx` and the tenant page's `tenant-billing.tsx`; files such as an invoice's PDF come through the console client's `file()`.
- Licence mode: with `LICENCE_FILE_PATH` and `LICENCE_PUBLIC_KEY`, `LicenceEntitlements` replaces the directory's entitlements. `pnpm licence keys|sign|check` (docs/runbooks/licences.md); the private key never enters the repository.

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
- The portal's and console's Content-Security-Policy is `infra/modules/web/content-security-policy.json`, which CloudFront, the Vite previews (and so the end-to-end tests) and the demo's Caddy all serve (decision D101); the previews also send CloudFront's other headers, `SECURITY_HEADERS` in `content-security-policy.mjs`, kept in step with `infra/modules/web/main.tf`. A new external source goes there, never inline script; zod runs `jitless` (`src/zod-setup.ts`, imported first). Session cookies come from `sessionCookie()` (`src/platform/session-cookie.ts` in the API): `__Host-`, Secure and Path=/ in production.
- Public pages (decision D100): `/privacy` and `/delete-account` (`src/pages/public-pages.tsx`) need no sign-in and are in `PUBLIC_PATHS`, which a session ending doesn't redirect from. The privacy notice's sections are `PRIVACY_NOTICE` in `@thelamp/i18n`, shared with the app's Privacy screen; change its text there, in both languages, and raise `PRIVACY_NOTICE_DATE`.
- Printing (decision D99): wrap what prints in `Printable` from `apps/web/src/print.tsx`, with its title and detail lines, and put a `PrintButton` beside it; the design system's print layout prints that sheet alone, in the Light theme. Never draw a PDF on the server for something the screen shows.
- Lists show ten rows a page with Previous and Next (decision D106): `DataTable` pages itself and asks the API for its next cursor page (`more`) when Next runs past the rows loaded; a list that isn't a table uses `Pager` with `usePagedRows` (`useQueryPaging` in the portal). The phone keeps Load more. Actions that can't be undone ask first, in place, with `Confirm`. Field errors come from the API's details by path, with `fieldErrors()` in `apps/web/src/people/shared.tsx`. Writes go through `write()` in `apps/web/src/people/data.ts`, which sends a fresh idempotency key.

## Background work (decision D39)

- Add a queue to `QUEUE_NAMES` in `apps/api/src/platform/queues.ts` with the first work that needs it. Register a handler per kind of job with `Queues.handle()` in the owning module's `onModuleInit`; only the worker process runs handlers.
- Heavy work for one tenant (imports, exports, archives, recomputes) registers with `{ perTenant: true }`: each tenant then runs at most its plan's `queueSlots` (else `QUEUE_DEFAULT_SLOTS`) of those jobs at once on the queue, counted by `TenantSlots` in Redis; a job over the limit is delayed a few seconds without spending an attempt (decision D98). Imports and exports cap their rows at `limits.importRows` and `limits.exportRows`. A new plan limit goes in `PlanLimits` and `PLAN_LIMIT_KEYS` (`@thelamp/shared`), the console's plan pages and their strings.
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

## Observability (decision D98)

- Error reports go to Sentry only once a DSN is set: `SENTRY_DSN` for the API, worker and scheduler (`startErrorReports()` and `reportError()` in `apps/api/src/platform/error-reports.ts`, called by the error filter for 5xx and by the queues for a job's last failed try), `VITE_SENTRY_DSN` for the web portal and the console (`src/error-reports.ts`, loaded only when a build has one), and `EXPO_PUBLIC_SENTRY_DSN` for the phone (`src/error-reports.ts`). Every event passes `scrub()` from `@thelamp/shared` first; errors only, no traces, replays or personal details. In Jest, `@sentry/react-native` is mocked.
- The scheduler's minute of health also becomes CloudWatch metrics when `CLOUDWATCH_METRICS` is on (`cellMetricLines()` in `modules/scheduling/cell-metrics.ts`, the embedded metric format on standard output), and the cell's alarms in `infra/modules/cell/alarms.tf` read them. A new figure goes in `CellFigures`, the reporter, and the metric lines if an alarm needs it.
- Security events go through `SecurityLog` (`src/platform/security-log.ts`, decision D101): the error filter logs every refusal whose code is in `SECURITY_CODES`, sign-ins log `signed_in` with their factors and `sign_in_failed` with a masked subject (`maskPhone()`, `maskEmail()` from `@thelamp/shared`) and reason, and every committed audit entry is mirrored as an `audit` line without its values (`whenCommitted()` on `Database` and `DirectoryDatabase`). Events carry the current request's ID, address, tenant and caller on their own; never put a number, address, code or token in one unmasked. Access lines name the tenant, caller and address (`callerOf()`).
- `pnpm verify` validates every Terraform environment set up on the machine, borrowing another environment's providers, offline, when one lacks this platform's.

## Odometer readings (decision D99)

- The `odometer` setting (`off`, `optional`, `required`) asks for a reading and a live photo at punch-in and punch-out; `ShiftsService` checks them with `odometerIssue()` and attaches the photo (media kind `odometer`) to the shift. The kilometres between are `shiftOdometerKm()`; both are in `packages/shared/src/tracking.ts`. Readings are shown beside the tracked distance, never in its place.
- A per-km claim may name its day's shift (`shiftId`): `ExpenseClaimsService` takes the shift's readings through `ShiftsService.odometerFor()`, counts its photos (owner `shift`) and flags `odometer_changed` when the readings given differ.
- On the phone, `OdometerStep` (`src/screens/odometer-step.tsx`) takes the reading and photo; punch-in asks after the selfie and `/punch-out` asks at the end. `Tracking.openOdometer()`, `closeOdometer()` and `odometersOn()` keep each shift's readings on the phone, and a new claim starts from them, waiting for the punch-out's upload.

## Retention (decision D69)

- BR-41's rules are pure functions in `packages/shared/src/retention.ts`: `locationRetention()` says which of a tenant's days are archived, purged and expired. A day is archived only after `LOCATION_SETTLE_DAYS`, the longest sync window and a day, so no phone can still send points for it.
- `LocationArchive` (`apps/api/src/modules/field/location-archive.ts`) runs in `field.nightly`: each settled day's raw points go to the object store as Parquet (`location_archive` media, recorded in `cell.location_archives`), an archived day's points are deleted after the raw retention, and trails and archive files after the trail retention. Never delete points of a day that isn't archived.
- `cell.drop_empty_location_partitions()` runs with the partitions job and drops only empty partitions older than `LOCATION_PARTITION_KEEP_DAYS`.
- Evidence photos and signatures expire in `PhotosService.expireEvidence()` (`media.retention`, nightly per tenant) by the keeping time they were captured under; `MediaService.expire()` removes a file with its derivatives and marks the row deleted. Retention is the app's; the bucket's lifecycle rules only tidy.
- Notifications, uploaded import files and the audit log follow the tenant's `notificationRetentionDays`, `importFileRetentionDays` and `auditRetentionYears` (decision D95): `RecordRetention` (`src/modules/governance/record-retention.ts`) runs nightly with the cutoffs from `recordCutoffs()`, and each owning module removes its own (`NotificationsService.removeOlderThan()`, `ImportsService.expireFiles()`, `AuditLog.purgeBefore()`, which goes through `cell.purge_audit_log()` as the log is append-only).
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
- Anything that changes a person's day recomputes it: the consumers in `performance.upkeep.ts` follow `submission.created`, `submission.reviewed`, `visit.ended`, `plan_item.status_changed`, `order.placed`, `order.status_changed`, and `account.created` and `account.updated` for the creator's day (D97). A new source of metric values needs its event consumed there and its calculator in `calculate.ts`, added to `COMPUTED_SOURCES`.
- Values belong to the capturing person and the capture's date on the tenant's clock (BR-03): filter moments with `onLocalDate()` from `src/platform/local-day.ts`.
- Scores and ranks are `scoreOf()` and `rankByScore()` from `@thelamp/shared` (BR-06, BR-07), computed on read by `PerformanceService` from locked targets; ranking groups are designations marked ranked (D8).
- The web shows a metric with `MetricTile` in `apps/web/src/performance/shared.tsx`, on the design system's `KpiTile` from `@thelamp/ui-web`, and formats values by unit with `useFigure()`.
- On the phone (decision D57), My month on Home (`src/screens/my-month.tsx`) reads `useMyMonth()` from `apps/mobile/src/performance.ts`, kept on the phone with when it was read; tiles use `KpiTile` from `@thelamp/ui-mobile` and `useTileParts()`, which shortens values to lakh and crore. The leaderboard (`/leaderboard`) is read online.

## Notifications (decisions D58, D59 and D85)

- Notifications live in `apps/api/src/modules/notifications`. An event's category, channels in order and urgency are in `NOTIFICATION_KINDS` in `@thelamp/shared`; its text is `notify.*` in the i18n catalogue, chosen by `notificationMessage()` from `@thelamp/i18n`, which the server, the web and the phone all use. A new event needs all three.
- Notify with `NotificationsService.notify(tx, tenantId, { userId, event, values, link, dedupeKey })` in the transaction of the change, usually from an outbox consumer in `notifications.upkeep.ts`. The `dedupeKey` names the occurrence, so a redelivered event notifies once. Values that differ by language go in as `<name>_en` and `<name>_hi`.
- Delivery runs on the `notifications` queue (`NotificationDelivery`): push, then the next channel when one can't reach the person. Senders follow `PUSH_PROVIDER`, `SMS_PROVIDER` and `EMAIL_PROVIDER`: console locally, memory in tests (`MemoryPushSender` and friends), refused in production. Never log a number, address or token unmasked: use `maskPhone()`, `maskEmail()` and `maskToken()`.
- WhatsApp (decision D85) reaches only people whose `whatsapp_consents` row agrees to the current `WHATSAPP_CONSENT_VERSION`, in the approved template `WHATSAPP_TEMPLATES` names for the event and language; without either it is skipped or fails with the reason and the next channel is tried. `WHATSAPP_PROVIDER` is `off` in production until a provider account exists; a new event that should go by WhatsApp needs its approved template there. Raise the consent version whenever the `whatsapp.consent` text changes.
- On the phone (decision D59), `usePushRegistration()` and `useNotificationTaps()` in `apps/mobile/src/push.ts` run in the signed-in layout; a tapped notification opens its link through `openLink()`, and `APP_PATHS` lists the screens it may open. The inbox is `src/screens/notifications.tsx` with the hooks in `src/notifications.ts`. Push needs a development build and Firebase's `google-services.json`, which EAS supplies as the `GOOGLE_SERVICES_JSON` file variable and is never committed. In Jest, mock `expo-notifications` and `expo-device`.

## Maps (decisions D60 and D61)

- Map reads live in `apps/api/src/modules/maps`: `GET /v1/live`, `/v1/account-pins`, `/v1/trails` and `/v1/density`. They reach shifts, points, trails, visits and accounts only through those modules' services, within the caller's scope. The rules are pure functions in `packages/shared/src/maps.ts`: `isStale()`, `positionAt()`, `pathLengthMeters()` and `decodePolyline()`.
- The web draws maps only through `apps/web/src/maps/map.tsx` (`MapView`, `Dot`, `Route`, `Area`), on `@vis.gl/react-google-maps`, with colours from the tokens: status tones, and `seriesOf()` for account types, filled once visited. Without `VITE_GOOGLE_MAPS_API_KEY` a map shows a notice, as in Vitest and Playwright; keep whatever a map shows also readable in a list or table beside it.
- `VITE_` settings come from the root `.env` (`envDir`). Only the vendor keys exist for now; per-tenant keys arrive in step 16.
- On the phone (decision D61), draw maps only through `apps/mobile/src/maps.tsx` (`PhoneMap`, `Spot`, `Ring`, `Line`) on react-native-maps; `maps.web.tsx` stands in for the web target and `jest.setup.ts` mocks the library, so a map in a test is a view labelled with its name and markers with their titles. Android's key comes from `GOOGLE_MAPS_ANDROID_KEY` in EAS through the config plugin in `app.config.ts`, never committed. Managers' live and trail reads are `useLive()` and `useTrail()` in `src/maps-data.ts`, online only.

## Dashboards, reports and exports (decisions D62 and D63)

- Reports live in `apps/api/src/modules/reports`. A report is a `ReportSource` (`sources.ts`) registered in `ReportsService`: its columns and a page of rows, read through the owning modules' services. Add its key to `REPORT_KEYS` in `packages/shared/src/schemas/reports.ts` and its name to `report.name_<key>` in the strings.
- `ReportsService` narrows every report to the caller's scope and the filters, for one month on the tenant's clock, and resolves headings and coded values in the requested `locale` with the tenant's terms: cells hold words, numbers, ISO dates and moments.
- A report that needs more than `report.view` names it in `REPORT_PERMISSION` (decision D86), as the audit log, the orders register, the account statement and the GPS audit trail do; a report reached by account rather than person reads the caller from its context (`context.access`). A report too large to read for a whole team goes in `REPORT_FOR_ONE_PERSON` and needs `userId` (decision D99), as the GPS audit trail (`gps-audit-trail.ts`, reading through `LocationsService.auditPoints()`) does.
- Exports run on the `exports` queue (`ExportsService.run`), as the requester may see at that moment, and are kept for 7 days (`EXPORT_KEEP_DAYS`). Write files only through `toCsv()` and `toXlsx()` in `files.ts`, which keep text from starting a formula (`neutraliseFormula` in `@thelamp/shared`). Only the requester reads an export, every request and download is audited, and BullMQ job IDs never contain `:`.

- The web Home reads `GET /v1/dashboard` (`DashboardService` in the reports module, with `PerformanceService.dashboard()` for tiles, trend and leaderboard). Draw charts only through `Chart` in `apps/web/src/charts/chart.tsx`, which takes colours from the tokens with `token()`, follows the theme, stops motion under reduced motion, and keeps a Show the numbers table beside every chart. Register any ECharts part a chart needs in `echarts.use()` there. Status series use the status `-solid` tokens; pending is hatched as well as coloured.

## Approval chains and the inbox (decisions D74 and D76)

- Chains live in `apps/api/src/modules/workflow`: `ChainsService` keeps each request type's chain as versions (`cell.workflow_definitions`) and the fallback role; a request records the version that routed it. A type without a chain goes to the requester's manager (D38).
- Start a request with `ApprovalsService.request(tx, tenantId, requesterId, type, requestId, actor, { accountId, facts })` in the transaction that makes it: `accountId` for `account_slot` steps, `facts` keyed as `REQUEST_FACTS` in `@thelamp/forms` for step conditions. A new request type registers with `RequestTypes` (its `decided` also receives `cancelled`, applied as a rejection), names its `module` when it isn't Core's, so its requests leave the inbox and refuse decisions while that module is off (D84), and adds its facts to `REQUEST_FACTS`.
- Routing is `routeRequest()` in `@thelamp/shared` (BR-31); the resolvers are `Approvers` (`People.ancestors`, `Scopes.holdersReaching`, the accounts' slot seam). Moving to a later step, escalating and reminding publish `approval.waiting`; reminders and escalations run every 15 minutes (`approvals.keep_time`).
- Step schemas (`Approver`, `WorkflowStep`) are the form engine's, in `@thelamp/forms`; templates re-export them. The web edits chains at Settings → Approval chains with the form builder's `ConditionEditor`.
- The inbox (decision D76): `GET /v1/approvals/inbox` (with `counts` by type), `/mine` and `POST /v1/approvals/decisions` for bulk approval. A type opts into bulk with `bulk: true` on its registration; each item runs in `Database.savepoint()`, so one refusal leaves the rest approved. The web inbox is `apps/web/src/approvals/` (chains drawn with `ApprovalSteps`); on the phone managers decide in the Team tab and `/approvals/<id>` (`src/approvals.ts`), online, one at a time.

## Catalogue and prices (decision D77)

- Pricing is pure functions in `packages/shared/src/pricing.ts`: `priceLine()` (BR-10 to BR-12, by the catalogue's `rounding`), `orderTotals()` and `orderSizeIssue()` (BR-13), `quoteDifferences()` (BR-14), `expectedPriceIssue()` (BR-17), and `applicableLists()` with `priceFor()` for which list prices an item at an account. Amounts are decimal strings; compute with these functions or `scaled()` and `unscaled()`, never `Number`.
- Items and price lists live in `apps/api/src/modules/catalogue`: `ItemsService` (`PUT /v1/items/{id}`, and `product()` for products and categories by name) and `PriceListsService` (lists, entries at the list's version, `forAccount()` for what an account pays). Every change audits and calls `CatalogueService.touch()`. A removed price keeps its row with `removed_at`.
- The web edits items at Settings → Catalogue and lists at Settings → Price lists (`apps/web/src/catalogue/`).
- Phones keep price lists and prices as the `price_lists` and `prices` sync entities (`price-lists.sync.ts`): every list but those for single accounts the person doesn't see, with a scope that hashes the visible lists, so any change to which lists apply re-sends both. On the phone, `useAccountPrices()` in `apps/mobile/src/prices.ts` works out an account's prices with `applicableLists()` and `priceFor()`; the prices screen is `/prices/<accountId>`.

## Orders (decision D78)

- Orders live in `apps/api/src/modules/orders`. `OrdersService.place()` prices every line with `applicableLists()`, `priceFor()` and `priceLine()` on the day the order was placed, refuses with `PRICE_CHANGED` what the device showed otherwise (`quoteDifferences()`), and keeps each line's item as it was (BR-15). The status rules are `statusFromLines()` and `statusAfterFulfilment()` in `packages/shared/src/orders.ts` (BR-19); GST halves are `gstHalves()`.
- An order's approval is decided on its own page: `ownPage` on its `RequestTypes` registration makes the inbox link there (`page`) and the generic decision refuse it. Decide through `OrdersService.decide()` and `decideLines()`, which call `ApprovalsService.decide(..., owner = true)`; `ApprovalsService.waiting()` says whether the step decides by line. Account finance provides `over_credit` through `OrderCredit.provide()`.
- The web's orders are `apps/web/src/orders/`: the register, an order's page and the order desk.
- On the phone, the cart is `/order/<accountId>` (`src/screens/order.tsx`) with `priceCart()`, `orderBody()`, `queueOrder()` and `repriceRefused()` in `apps/mobile/src/orders.ts`; orders upload as `order.place`, after their visit's check-in. A parked upload's payload changes only through `Outbox.replace()`. Phones keep their person's orders as the `orders` sync entity.

## Account finance (decision D79)

- Finance lives in `apps/api/src/modules/finance` (`FinanceService`). The rules are pure functions in `packages/shared/src/finance.ts`: `ageingIssue()` and `bucketsIssue()` (BR-20, buckets from the `ageingBuckets` setting), `entryIssue()`, `openingBalance()` and `runningBalances()` (BR-21), `financialYear()`.
- Snapshots are all kept; read the latest with `FinanceService.latest()`. Statement entries are only ever added, keyed by reference: `planEntries()` tells new, unchanged and refused apart for the API and the import alike. Never update or delete a ledger entry; a correction is a reversing entry.
- The finance module provides `OrderCredit`, which decides an order's `over_credit` fact.
- Phones keep each account's latest balance as the `balances` sync entity, keyed by the account; read it with `useBalance()` in `apps/mobile/src/finance.ts`, and judge an order with `overCredit()`.

## Attendance and calendars (decision D80)

- A day's status is `dayStatus()` in `packages/shared/src/tracking.ts`, the whole of BR-23 in priority order; `scheduledDays()`, `paidDays()` and `regularisationIssue()` are in `packages/shared/src/attendance.ts`. `AttendanceService.days()` gathers its inputs; `store()` keeps the stored days that reports read, so anything that changes a day gone calls it in the same transaction.
- Calendars and holidays are `CalendarsService` in `apps/api/src/modules/field`; a person's calendar is `users.calendar_key` (null keeps the default), read through `People.employment()` and `CalendarsService.forPeople()`. Optional holidays never take a day off.
- Leave reaches attendance only through the `AttendanceLeave` seam: the leave module calls `provide()` with its approved days.
- Regularisations are `RegularisationsService`, the `regularisation` request type: one waiting or approved request a person a day. Only an approved one changes the day.
- On the phone, `/attendance` (`src/screens/attendance.tsx`) reads the month with `useMyAttendance()`, kept offline, and asks to fix a day with `queueFix()` (outbox kind `regularisation.create`); `fixable()` in `apps/mobile/src/attendance.ts` says which days may be asked about.

## Leave (decision D81)

- Leave lives in `apps/api/src/modules/leave`: `LeaveTypesService` (types keyed by configuration key, never removed, switched off instead) and `LeaveRequestsService` (requests, balances, the `leave` request type, and the days it provides to attendance through `AttendanceLeave`). The rules are pure functions in `packages/shared/src/leave.ts`: `leaveDays()` and `leaveIssues()` (BR-27), `quotaYear()`, `leaveBalance()`.
- Count a request's days on the person's own calendar (`CalendarsService.forPeople()` and `offOn()`); approved leave never marks a weekly off or holiday.
- `LeaveType` is `@thelamp/shared`'s; templates re-export it.
- On the phone, `/leave` and `/leave/new` read through the kept hooks in `apps/mobile/src/leave.ts`, preview a request with `previewLeave()` and queue it with `queueLeave()` (outbox kind `leave_request.create`). Month grids use `MonthDays` (`src/screens/month-days.tsx`).

## Expenses (decision D83)

- Expenses live in `apps/api/src/modules/expenses`: `ExpensePoliciesService` (policies keyed by configuration key, each change a version from a day; `on()` finds the version in force on a day) and `ExpenseClaimsService` (claims, receipts, payment, the `expense` request type). The rules are pure functions in `packages/shared/src/expenses.ts`: `claimBase()`, `capClaim()`, `claimIssues()` (BR-29), `receiptHoldsApproval()` (BR-30), `rateFor()`, `expensePolicyIssues()`. Money goes through them, exact as paise.
- A request type that must hold an approving decision answers it in `approvable()` on its `RequestTypes` registration; the approvals engine asks before every approval, bulk included.
- Receipts and odometer photos are media owned by their claim (`expense_claim`); read them with `PhotosService.ownedBy()`. Duplicates come from the media pipeline's `duplicate_of_id` (BR-40) and are flagged, never blocked.
- `ExpensePolicy` is `@thelamp/shared`'s; templates re-export it.
- On the phone, `/expenses` and `/expenses/new` read through the kept hooks in `apps/mobile/src/expenses.ts`, preview a claim with `previewClaim()`, and queue claims (`expense_claim.create`) and receipts for a waiting claim (`expense_claim.receipts`).

## Tenant administration (decision D64)

- Settings are `TenantSettings`; the apps read them from the bundle through `BundleSettings`, which drops settings they don't know and fills missing ones with defaults, so settings may only ever be added. The display name is the directory's (`TenantDirectory.rename()`), the logo a `logo` media file behind `/v1/organisation/logo`.
- A tenant's accent comes only from `deriveAccent()` in `@thelamp/shared`, as `packages/design-tokens/tenant-theming.md` sets out: on the web through `applyBrand()` in `apps/web/src/brand.ts`, on the phone through `Look` (`src/look.tsx`) and `ThemeProvider`'s `accent`. Never hard-code a tenant colour.
- Modules: put a new module's permissions in `MODULE_PERMISSIONS` and its reports in `REPORT_MODULE` (`@thelamp/shared`). Switched off, IAM strips their permissions and the guard answers `MODULE_DISABLED`; mark a route whose permissions are Core's but which belongs to a module with `@InModule()`. A module's sync entities send nothing while it is off, with a scope of `off`, so phones drop their copies (D82). Screens of a module read `settings.modulesOff` from the bundle to hide themselves.
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
- The Privacy screen (`src/screens/privacy.tsx`, route `/privacy` outside the sign-in guard) shows `PRIVACY_NOTICE` and, signed in, the tenant's `privacyPolicyUrl`. The iOS privacy manifest and the exempt-encryption flag are in `app.config.ts`; a native module that reads a required-reason API without its own manifest adds its reason there (decision D100).
- The stores' answers are `docs/store/google-play.md` and `app-store.md` (decision D100): the listings, Data safety, App privacy and the location declarations. A change to what the app collects, asks for or shows (a permission, a data type, a screen in the listing) updates them, and the privacy notice, in the same pull request. `node tools/store/graphics.mjs` redraws Play's icon and feature graphics.
- Cloud builds (`eas build`) run on Kunal's Expo account (D34): ask first.

## Configuration and templates

- Tenant configuration (account types, forms, metrics, workflows, policies) is data, checked in two layers: a zod schema for its shape, then checks that every reference resolves and settings agree. Form schemas are in `packages/forms`, metric and score schemas in `packages/metrics`, the rest in `packages/templates/src/schema`.
- Checks return `ErrorDetail` lists (`{ path, issue }`, the spec 11.1 format) built with `issueAt`, so the API can return them as they are.
- Configuration refers to other configuration by key, never by ID. Keys match `^[a-z][a-z0-9_]{0,39}$` and never change once used.
- Configuration text is in English and Hindi. Names of countable things carry `one` and `other` forms.
- Money in configuration is a decimal string; compare amounts with `toMinorUnits`.
- Forms publish as versions through `FormsService` (decision D45): a form keeps its key, and a field keeps its type once any version used it. Check submitted values with `checkFormValues` from `@thelamp/forms`, on the server and in the apps alike. Compile a configured pattern with `compilePattern` (re2js, linear time), never `new RegExp`.
- A form filled in a visit sees `visit_ordered` before its first field (decision D97): the server answers it through the `VisitOrders` seam (field module, provided by orders), the phone with `visitOrders()` in `apps/mobile/src/visits.ts`, and both pass it to `checkFormValues` as `visitOrdered`. Whether a signature is needed is `signatureRequired()` from `@thelamp/forms`, never `signature === 'required'`. A product lines field with `quantities: false` keeps every line as one.
- Industry templates live at `packages/templates/<key>/template.json`; see its README. Raise a template's `version` with every change, and keep schema changes additive.

## Migrations

Migrations are append-only and backward compatible. They follow expand and contract: add, backfill in a job, switch reads, then remove the old structures in a later release. Never hold long locks on large tables: use `CREATE INDEX CONCURRENTLY` and batched backfills.

## Testing (spec 14.4)

- **Unit:** Vitest for business rules, the form engine and metrics; Jest with jest-expo for React Native components and screens.
- **Integration:** Testcontainers and supertest against real migrations and RLS.
- **Cross-tenant contract test:** `test/cross-tenant.int.test.ts`, generated from the route registry; it fails for a route without a fixture. A new route's fixture has tenant B try tenant A's IDs: `sameAsNowhere()` for anything that takes an ID, `holdsNothingOfA()` for reads, and every row of A's is compared after each request.
- **Phase exit checks:** `test/phase-2-exit.int.test.ts` reconciles each invoice in `test/fixtures/invoices` to the paisa (real ones in the git-ignored `private/` folder) and passes requests through their chains against a register counted by hand. `test/phase-3-exit.int.test.ts` onboards a tenant through the console to a field person's first punch-in, then charges it end to end through the stand-in gateway (decision D100).
- **End to end:** Playwright (with axe) for the web apps; Maestro for mobile, run by hand in CI or locally with `apps/mobile/.maestro/run.sh` (decisions D68 and D75). Flows select by the screen's English text and run against a fresh tenant from `e2e:fixtures`, never seeded people; sign-in codes come from Mailpit (`OTP_PROVIDER=mailpit`).
- **Load:** k6 in `tools/k6`, with spec 3.2's targets as thresholds; sessions come from `load:fixtures`, one person per virtual user.
- **Merging (decisions D75 and D92):** GitHub's free minutes cover only the quick checks, so pull requests and merges to main run formatting, types, lint and unit tests there; integration, end-to-end, the image and Terraform run on main nightly when something merged that day, or by hand, and deploys follow those full runs. Before merging, run `pnpm verify` locally and note its result and commit in the pull request. A pull request merges only with its quick checks green and `pnpm verify` passing; while GitHub refuses to start jobs because the month's minutes are used up, `pnpm verify` alone, with the refusal noted in the pull request.

## Security scanning (decision D100)

- `tools/semgrep/scan.sh` (in `pnpm verify` and nightly CI) runs Semgrep CE from its pinned image with the registry's packs and our rules in `tools/semgrep/rules.yml`. A new rule gets `ruleid:` and `ok:` cases in `tools/semgrep/rules.ts`. A finding that is safe says why beside it, with `nosemgrep: <rule id>`; never silence one without the reason.
- `pnpm audit --audit-level high` fails on high and critical advisories. An exception goes in `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` only with its review in `docs/security/dependency-advisories.md`; remove it once the fix is two weeks old.
- `tools/zap/scan.sh` runs OWASP ZAP, pinned by digest, against the API and the portal on this machine: the portal's baseline scan and the API scan from the OpenAPI document, without a token and as a manager on a phone (decision D101). Run it by hand before a release and before the penetration test; it isn't in `pnpm verify`. A false positive goes in `tools/zap/rules.tsv` with why; the findings and what was done are in `docs/security/zap.md`.
- `docs/security/` holds the ASVS Level 2 review (`asvs-l2.md`) and the documents it rests on: `authentication.md` (ways in, limits, sessions), `keys-and-crypto.md`, `data-classification.md`, `logging.md` and `field-access.md`, with the penetration test's scope pack (`penetration-test.md`, whose findings table records each finding and its fix); spec 12.2 lists every file the product takes or gives and `docs/services.md` what each process reaches. A change to what they describe updates them in the same pull request.
- Actions in `.github/workflows` are pinned to a commit with the release in a comment; a tool fetched in CI is a pinned release checked against its digest, never a script piped to a shell, and `${{ }}` values reach `run:` scripts through `env:`.

## Deployment (decision D67)

- One image, `apps/api/Dockerfile`, runs every cell process: the API by default, and `node dist/worker.mjs`, `dist/scheduler.mjs`, `dist/migrate.mjs` and `dist/bootstrap.mjs`. Build it from the root: `docker build -f apps/api/Dockerfile .`. The API bundles the workspace packages, so they stay in its `devDependencies`; a new npm package the API imports at runtime goes in `dependencies`.
- `infra/` holds the Terraform: `environments/staging` and `environments/production` compose `modules/environment` (network, ECR, certificates, the cell, the web portal, the GitHub deploy role). Change sizes in an environment, not in the modules. CI runs `terraform fmt -check` and `validate`; nothing is applied from CI.
- A new setting reaches AWS in `modules/cell/services.tf`: a plain value in the processes' environment, or a key of the cell's secret in `secret_keys`. Production refuses console and memory providers, so a new provider needs its real sender before it can be switched on.
- The image's base is pinned by digest; take a newer one only once it is two weeks old. It carries `sbom.cdx.json` (`pnpm sbom`) and leaves out `seed`, `load-fixtures`, `e2e-fixtures` and `openapi`; `demo-content` stays only with `--build-arg PURPOSE=demo`, which `demo.sh` passes (decision D101).
- `.github/workflows/deploy.yml` deploys main after CI, staging then production, once `DEPLOY_ENABLED` is true. Setting up, deploying, rolling back and a failed migration: `docs/runbooks/`.
- The WAF (decision D98, docs/runbooks/web-firewall.md): the cell's ACL throttles sign-in per address for requests without CloudFront's `X-Origin-Verify` header, which the environment module makes once; the web module's CloudFront ACL (us-east-1) throttles the rest per viewer. A new sign-in route goes in the pattern in both modules. The quarterly restore drill is `infra/scripts/restore-drill.sh`, with `dist/restore-check.mjs` in the image (docs/runbooks/restore-drills.md).
- SMS in India goes through DLT templates only: one-time codes and SMS notifications are sent by MSG91 in templates (`MSG91_OTP_TEMPLATE_ID`, `MSG91_SMS_TEMPLATES` by event and language), never as free text. A new event that should reach people by SMS needs its approved template added there.

## The demo (decision D70)

- The demo runs the whole product on one EC2 instance in Kunal's AWS sandbox, on the Free plan's credit: Docker Compose (`infra/demo/compose.yaml`) with Caddy at `app.thelamp.in`; Terraform in `infra/environments/demo`, with local state. It isn't staging; nothing carries over to the company's accounts.
- A demo cell is `CELL_PURPOSE=demo`: production code with `OTP_PROVIDER=none` and console senders for SMS and email (numbers masked). A live cell refuses both.
- People sign in to demo tenants (`pnpm provision --demo`, the `demo` flag in `directory.tenants`) with fixed codes from `DEMO_CODES`. A code works only while its number's tenant is a demo tenant, and a number belongs to one tenant (D103), so each demo tenant needs demo numbers of its own: the content generator gives a slot whose demo number is taken elsewhere a fictional one; keep the codes in `terraform.tfvars`, never in the repository.
- `src/demo-content.ts` (`demo:content`, `demo.sh content`) fills a new demo tenant with weeks of work through the services, under the simulated clock of `src/demo/clock.ts`; storage signs with real time. Keep it reading the tenant's configuration, never a template's keys. Only its words follow the template: names, products, notes and gatherings come from `flavourOf()` in `src/demo/names.ts` (decision D97), and a new industry template adds its flavour there. Phase 2's work lives in `DemoCommerce` (`src/demo/commerce.ts`: price lists, orders, deliveries, statements) and `DemoRequests` (`src/demo/requests.ts`: holidays, leave, fixed days, claims and the evening's decisions), which reach the generator through `DemoKit` (`src/demo/kit.ts`).
- A new setting the demo needs goes in `local.settings` in `infra/environments/demo/main.tf`, as well as the cell's `modules/cell/services.tf`.

## Design system

- The look is **Field** (decision D72): Forest accent and harvest gold (`brand-forest`, `brand-gold`, `on-brand` are the product's own, never a tenant's), Mukta for Latin and Devanagari, sturdy corners (buttons `radius-md`), and the pin-and-flame mark. The portal's shell uses `ks-rail`, `ks-appbar` and `ks-auth` from `bundle.css`.
- `packages/design-tokens` holds the design system. `tokens.json` is the source of truth, and `tokens.css` and `tokens.ts` are generated from it. The package also holds the brand book (`README.md`), the component guides, the reference `bundle.css` and the logos.
- UI code takes colours, spacing, radii, type and motion from the tokens, never hex values or hand-picked timings. Motion honours reduced motion (`prefers-reduced-motion`, and `data-motion` on the root).
- The same system is published as a claude.ai Design System artifact: https://claude.ai/artifact/REeP6ZXP72DN9kfhVHbPT3. Make every design-system change in both places in the same piece of work.
- Run `pnpm tokens` whenever `tokens.json` changes. The token tests fail when a generated file is stale, a themed token misses a theme, or a colour pair named in the usage notes falls under its contrast floor.
- Prettier ignores `packages/design-tokens/` and all markdown, so the mirrored files stay byte-identical to the artifact.
