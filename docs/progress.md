# Progress

This file tracks where the build stands against the delivery phases in spec section 15. Update it in the same pull request as every step, so it never drifts from the code.

Last updated: 2026-10-05

## Now

- **Phase 0, step 3** (the templates package) is in review as [kunal-boyal/kshetra#3](https://github.com/kunal-boyal/kshetra/pull/3). Both templates validate, which meets the third exit criterion of phase 0.
- **Next:** Phase 0, step 4, the directory module: OTP sign-in and tokens.
- **Also made:** a clickable prototype of the field app and the manager portal: https://claude.ai/artifact/9VVuerfkU3vfou35KDiLZW

## Phase 0: Foundation

The spec plans 3–4 weeks for this phase.

**Exit criteria:**
- a user signs in on a phone and on the web, into either of two seeded tenants
- the cross-tenant contract test passes
- both templates validate

Each step is its own pull request. The order follows dependencies.

| Step | Capability | Status | Pull request |
|---|---|---|---|
| 1 | Monorepo, CI, local services, `CLAUDE.md` | Done | #1 |
| 2 | API and database foundation: `apps/api` (NestJS), migrations, database roles, tenant context with row-level security, error codes, idempotency | Done | #2 |
| 3 | Templates package: schema, validator, and the generic and agri templates; form and metric definitions in `packages/forms` and `packages/metrics` | In review | #3 |
| 4 | Directory module: OTP sign-in, tokens (ES256, JWKS), refresh, tenant switching, device binding (D15) | Next | |
| 5 | IAM: roles, data scopes, designations, closure tables | To do | |
| 6 | Config bundle, terminology resolver, i18n in English and Hindi | To do | |
| 7 | Audit log and outbox | To do | |
| 8 | Provisioning CLI, and a seed with two tenants on different templates | To do | |
| 9 | Web shell with sign-in: `apps/web`, `packages/ui-web`, the token build step | To do | |
| 10 | Mobile shell with sign-in: `apps/mobile` (Expo), `packages/ui-mobile`. Needs an Expo account. | To do | |
| 11 | Cross-tenant contract test over every route, and the phase 0 exit check | To do | |

## Done

| Date | What | Where |
|---|---|---|
| 2026-10-05 | Phase 0 step 2: the API, database roles, row-level security, error codes and idempotency (decisions D22–D24) | PR #2, merged as `033d3f1` |
| 2026-10-05 | Clickable prototype: 5 field-app screens and 4 manager-portal pages | claude.ai artifact |
| 2026-10-05 | Phase 0 step 1: monorepo, CI, local services (MinIO from Chainguard, decision D21) | PR #1, merged as `1e9a8ed` |
| 2026-10-05 | Design system v1: tokens in three themes, brand book, 15 components, logo and variants | `packages/design-tokens`, artifact version 8, decisions D17–D20 |
| 2026-10-05 | Repository created; every spec section 16 recommendation accepted | `main` at `1bb773c`, decisions D1–D16 |

## Open items

| Item | Who | Needed by |
|---|---|---|
| Turborepo's `AGENTS.md`: commit it, or switch it off with `"agentGuidance": false` | Kunal | Any time |
| D1: product name, domain and the legal entity that publishes the apps | Kunal | Before DLT registration and store listings |
| D2: name the pilot customer (agri inputs) | Kunal | Phase 1 |
| D3: seat prices and plan contents | Kunal | Before phase 3 |
| Expo account, for mobile builds | Kunal | Phase 0, step 10 |
| Accounts with long lead times: SMS provider with DLT, Google Play and Apple (each needs a D-U-N-S number), AWS | Kunal | Phase 1 |
| Outdoor theme field test, on two Android brands in midday sun (D19) | Team | Before onboarding suggests Outdoor |
| Confirm the template starting points: default role permissions (D26), leave types, and the agri expense rates (D27) | Kunal | Before the pilot |
| Have a native speaker review the Hindi text in both templates | Kunal | Before the pilot |
| The agri forms pick products from the catalogue, which spec 15 schedules for phase 2. Bring the item import (without prices) into phase 1, or the pilot can't fill those fields. | Kunal | Phase 1 planning |

## Later phases (spec section 15)

| Phase | Scope | Exit criteria |
|---|---|---|
| 1, Field core (the MVP), 8–10 weeks | Field modules M2–M9, push and SMS, maps, dashboards, imports, offline sync, location and media pipelines, form builder | A pilot week with one tenant on real phones |
| 2, Commerce and people, 6–8 weeks | Orders, account finance, expenses, attendance and leave, approval workflows, WhatsApp | Order totals reconcile with real invoices to the paisa |
| 3, SaaS readiness, 6–8 weeks | Public API, audit, platform console, billing, SSO, store releases, penetration test | A tenant onboarded from the console in under a day |
| 4, Growth | Driven by customer demand | Not fixed in advance |

See [services.md](services.md) for the services each phase brings in.
