# Kshetra

A multi-tenant field-force SaaS: an Android-first mobile app, a tenant web portal, a vendor console and a public API. [docs/Kshetra.md](docs/Kshetra.md) is the source of truth for scope and behaviour. If code and spec disagree, raise it with the owner (Kunal) and change one of them deliberately. Decisions are logged in [docs/decisions.md](docs/decisions.md).

## Status

Phase 0 (Foundation) hasn't started, so there is no application code yet and the commands below arrive with the monorepo scaffold. Build in the phase order of spec section 15. Meet each phase's exit criteria, tests included, before the next phase starts. Inside a phase, take one capability at a time through every layer: schema, shared rules, API, web, mobile, tests.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | runs the apps locally |
| `pnpm test` | unit tests |
| `pnpm test:int` | integration tests on Testcontainers (PostgreSQL with PostGIS, Redis) |
| `pnpm lint`, `pnpm typecheck` | static checks |
| `pnpm db:migrate`, `pnpm db:seed` | migrates; seeds fictional data and refuses non-local databases |
| `pnpm openapi` | regenerates the OpenAPI document and the typed client |

Local services run in Docker Compose: PostgreSQL with PostGIS, Redis, MinIO and Mailpit. Locally, OTP codes print to the console (`OTP_PROVIDER=console`); production refuses this.

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
- UI code takes colours, spacing and type from the tokens, never hex values.
- The same system is published as a claude.ai Design System artifact: https://claude.ai/artifact/REeP6ZXP72DN9kfhVHbPT3. Make every design-system change in both places in the same piece of work.
- Regenerate `tokens.css` whenever `tokens.json` changes. Until Phase 0 adds the token build step, regenerate it by hand.
