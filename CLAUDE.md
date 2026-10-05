# Kshetra

A multi-tenant field-force SaaS: an Android-first mobile app, a tenant web portal, a vendor console and a public API. [docs/Kshetra.md](docs/Kshetra.md) is the source of truth for scope and behaviour. If code and spec disagree, raise it with the owner (Kunal) and change one of them deliberately. Decisions are logged in [docs/decisions.md](docs/decisions.md). Every service the project uses, local and production, is listed in [docs/services.md](docs/services.md).

## Status

Phase 0 (Foundation) is in progress. [docs/progress.md](docs/progress.md) tracks every step: its status, its pull request, and the open items waiting on the owner. Update it in the same pull request as each step.

Build in the phase order of spec section 15. Meet each phase's exit criteria, tests included, before the next phase starts. Inside a phase, take one capability at a time through every layer: schema, shared rules, API, web, mobile, tests.

## Commands

| Command | What it does | Available |
|---|---|---|
| `pnpm install` | installs the workspace (pnpm 12, Node 24) | now |
| `pnpm typecheck`, `pnpm lint`, `pnpm test` | static checks and unit tests, through Turborepo | now |
| `pnpm format`, `pnpm format:check` | Prettier | now |
| `docker compose up -d` | starts the local services | now |
| `pnpm dev` | runs the apps locally (today the API, on http://127.0.0.1:3000) | now |
| `pnpm test:int` | integration tests against PostgreSQL in Docker, through Testcontainers (Docker must be running) | now |
| `pnpm db:bootstrap` | creates the database roles; refuses anything but a local or CI database | now |
| `pnpm db:migrate` | applies migrations as the `migrator` role | now |
| `pnpm --filter @kshetra/api db:generate` | writes a migration for a schema change | now |
| `pnpm --filter @kshetra/templates schema` | regenerates `packages/templates/schema.json` after a template schema change | now |
| `pnpm db:seed` | seeds fictional data and refuses non-local databases | with provisioning, step 8 |
| `pnpm openapi` | regenerates the OpenAPI document and the typed client | with the first `/v1` endpoints |

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
pnpm dev
```

Workspace packages are consumed as TypeScript source (`exports` points at `src/index.ts`), so they need no build step. Shared tool versions live once, in the `catalog` of `pnpm-workspace.yaml`. TypeScript stays on 6.0 until typescript-eslint supports 7; see `docs/versions.md`.

## Layout (spec 9.4)

```text
apps/        api (NestJS: main.ts, worker.ts, scheduler.ts, migrate.ts), web, console (Vite SPAs), mobile (Expo)
packages/    shared, forms, metrics, i18n, templates, api-client, design-tokens, ui-web, ui-mobile, config
infra/       terraform modules and environments
tools/       provisioning CLI, k6 load tests, data generators
docs/        the specification, decisions.md, versions.md, runbooks/
```

## Rules

- **Naming:** snake_case in the database, camelCase in TypeScript, kebab-case file names, kebab-case plural nouns in API paths. Every product name, package scope and identifier derives from one `PRODUCT_SLUG` value (working name: `kshetra`).
- **No industry words in code.** Distributor, retailer, farmer, doctor, beat, outlet, liquidation and similar terms belong in industry templates, seed data and translation strings. Code speaks of accounts, account types, forms, submissions, metrics, routes and plan items.
- **Tenancy:** every tenant-owned table has `tenant_id` and a row-level security policy from its first migration, indexes led by `tenant_id`, and an entry in the cross-tenant test fixtures. The cross-tenant contract test covers every endpoint.
- **Business rules** (spec section 7) are pure functions in `packages/shared`, tested with the Appendix D fixtures. The server is authoritative; clients call the same functions only to preview.
- **Schemas:** each request and response has one zod schema in `packages/shared/src/schemas/<module>`. Controllers never define ad hoc types.
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
- **New tenant tables:** put them in the `cell` schema with `tenant_id`, `.enableRLS()` and the `tenant_isolation` policy, as `apps/api/src/db/schema.ts` shows. `test/database.int.test.ts` fails for any `cell` table without them.
- **Schema changes:** edit `schema.ts`, run `db:generate`, and review the SQL before committing. Grants, and anything else Drizzle can't express, go in a migration made with `drizzle-kit generate --custom`.
- **Idempotent creates:** use `idempotent()` from `src/platform/idempotency.ts` (BR-46).
- **Errors:** throw `AppError` from `@kshetra/shared` with a spec 11.4 code; the global filter writes the spec 11.1 format.

## Configuration and templates

- Tenant configuration (account types, forms, metrics, workflows, policies) is data, checked in two layers: a zod schema for its shape, then checks that every reference resolves and settings agree. Form schemas are in `packages/forms`, metric and score schemas in `packages/metrics`, the rest in `packages/templates/src/schema`.
- Checks return `ErrorDetail` lists (`{ path, issue }`, the spec 11.1 format) built with `issueAt`, so the API can return them as they are.
- Configuration refers to other configuration by key, never by ID. Keys match `^[a-z][a-z0-9_]{0,39}$` and never change once used.
- Configuration text is in English and Hindi. Names of countable things carry `one` and `other` forms.
- Money in configuration is a decimal string; compare amounts with `toMinorUnits`.
- Industry templates live at `packages/templates/<key>/template.json`; see its README. Raise a template's `version` with every change, and keep schema changes additive.

## Migrations

Migrations are append-only and backward compatible. They follow expand and contract: add, backfill in a job, switch reads, then remove the old structures in a later release. Never hold long locks on large tables: use `CREATE INDEX CONCURRENTLY` and batched backfills.

## Testing (spec 14.4)

- **Unit:** Vitest for business rules, the form engine and metrics.
- **Integration:** Testcontainers and supertest against real migrations and RLS.
- **Cross-tenant contract test:** generated from the route registry. CI fails when a route has no fixture.
- **End to end:** Playwright (with axe) for the web apps, Maestro for mobile.
- **Load:** k6.
- **Merging:** a pull request merges only with typecheck, lint, unit and integration tests green.

## Design system

- `packages/design-tokens` holds the design system. `tokens.json` is the source of truth, and `tokens.css` is generated from it. The package also holds the brand book (`README.md`), the component guides, the reference `bundle.css` and the logos.
- UI code takes colours, spacing, radii, type and motion from the tokens, never hex values or hand-picked timings. Motion honours reduced motion (`prefers-reduced-motion`, and `data-motion` on the root).
- The same system is published as a claude.ai Design System artifact: https://claude.ai/artifact/REeP6ZXP72DN9kfhVHbPT3. Make every design-system change in both places in the same piece of work.
- Regenerate `tokens.css` whenever `tokens.json` changes. Until Phase 0 adds the token build step, regenerate it by hand.
- Prettier ignores `packages/design-tokens/` and all markdown, so the mirrored files stay byte-identical to the artifact.
