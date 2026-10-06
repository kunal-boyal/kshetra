# Progress

This file tracks where the build stands against the delivery phases in spec section 15. Update it in the same pull request as every step, so it never drifts from the code.

Last updated: 2026-10-06

## Now

- **Phase 0, steps 4 to 8** are merged: sign-in (#5), people and access (#6), configuration and languages (#7), the audit log and outbox (#8), and provisioning with the seed (#9). The first exit criterion holds for the API: on the seeded tenants, a person signs in on the web into either tenant, and a field user signs in on a phone.
- **Design system v2** (soft and pastel, decision D28) is merged with #4.
- **Next:** Phase 0, step 9: the web shell with sign-in.
- **The build tracker** shows every phase, step and task, with what is done and what is pending: https://claude.ai/artifact/RXrE65BV5qZ7fDqMCojxxs
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
| 3 | Templates package: schema, validator, and the generic and agri templates; form and metric definitions in `packages/forms` and `packages/metrics` | Done | #3 |
| 4 | Directory module: OTP sign-in, ES256 tokens and the JWKS, refresh rotation, choosing and switching tenants (D29) | Done | #5 |
| 5 | IAM: users, roles, data scopes, designations, closure tables, devices and device binding (D15, D30) | Done | #6 |
| 6 | Config bundle, terminology resolver, i18n in English and Hindi; the tenant settings that step 5 waits on: the device-binding switch, the timezone and the default country (D31) | Done | #7 |
| 7 | Audit log and outbox (D32) | Done | #8 |
| 8 | Provisioning command, and a seed with two tenants on different templates (D33) | Done | #9 |
| 9 | Web shell with sign-in: `apps/web`, `packages/ui-web`, the token build step | Next | |
| 10 | Mobile shell with sign-in: `apps/mobile` (Expo), `packages/ui-mobile`. Needs an Expo account. | To do | |
| 11 | Cross-tenant contract test over every route, and the phase 0 exit check | To do | |

## Done

| Date | What | Where |
|---|---|---|
| 2026-10-06 | Kunal confirmed decisions D29 to D33, and switched off Turborepo's `AGENTS.md` (CLAUDE.md is the agents' guide) | `docs/decisions.md`, `turbo.json` |
| 2026-10-06 | Design system v2, soft and pastel: a pastel palette, rounder shapes, soft shadows, icon chips, and motion tokens and patterns | PR #4, `packages/design-tokens`, artifact version 10, decision D28 |
| 2026-10-06 | Phase 0 step 8: the provisioning command, and a seed of two tenants on different templates (decision D33) | PR #9, merged as `b6f6b28` |
| 2026-10-06 | Phase 0 step 7: the audit log, the outbox and its relay (decision D32) | PR #8, merged as `dbfb92f` |
| 2026-10-06 | Phase 0 step 6: the config bundle, tenant settings, terminology, and English and Hindi strings (decision D31) | PR #7, merged as `57e4102` |
| 2026-10-06 | Phase 0 step 5: users, roles, scopes, designations and device binding (decision D30) | PR #6, merged as `cfc8ee3` |
| 2026-10-06 | Phase 0 step 4: sign-in with one-time codes, tokens and sessions (decision D29) | PR #5, merged as `bace236` |
| 2026-10-05 | Phase 0 step 3: templates package, with form and metric definitions (decisions D25–D27) | PR #3, merged as `98a11b7` |
| 2026-10-05 | Phase 0 step 2: the API, database roles, row-level security, error codes and idempotency (decisions D22–D24) | PR #2, merged as `033d3f1` |
| 2026-10-05 | Clickable prototype: 5 field-app screens and 4 manager-portal pages | claude.ai artifact |
| 2026-10-05 | Phase 0 step 1: monorepo, CI, local services (MinIO from Chainguard, decision D21) | PR #1, merged as `1e9a8ed` |
| 2026-10-05 | Design system v1: tokens in three themes, brand book, 15 components, logo and variants | `packages/design-tokens`, artifact version 8, decisions D17–D20 |
| 2026-10-05 | Repository created; every spec section 16 recommendation accepted | `main` at `1bb773c`, decisions D1–D16 |

## Open items

| Item | Who | Needed by |
|---|---|---|
| D1: product name, domain and the legal entity that publishes the apps | Kunal | Before DLT registration and store listings |
| D2: name the pilot customer (agri inputs) | Kunal | Phase 1 |
| D3: seat prices and plan contents | Kunal | Before phase 3 |
| Expo account for mobile builds: sign up at expo.dev, then run `eas login` in a terminal (the EAS command-line tool is installed). Accounts and passwords stay with you. | Kunal | Phase 0, step 10 |
| Accounts with long lead times: SMS provider with DLT, Google Play and Apple (each needs a D-U-N-S number), AWS | Kunal | Phase 1 |
| Outdoor theme field test, on two Android brands in midday sun (D19) | Team | Before onboarding suggests Outdoor |
| Review the soft pastel design system (D28): the hues, how round, and how fast the motion is | Kunal | Before the web shell, step 9 |
| Confirm the template starting points: default role permissions (D26), leave types, and the agri expense rates (D27) | Kunal | Before the pilot |
| Have a native speaker review the Hindi text in both templates and in `packages/i18n` | Kunal | Before the pilot |
| The agri forms pick products from the catalogue, which spec 15 schedules for phase 2. Bring the item import (without prices) into phase 1, or the pilot can't fill those fields. | Kunal | Phase 1 planning |

## Later phases (spec section 15)

| Phase | Scope | Exit criteria |
|---|---|---|
| 1, Field core (the MVP), 8–10 weeks | Field modules M2–M9, push and SMS, maps, dashboards, imports, offline sync, location and media pipelines, form builder | A pilot week with one tenant on real phones |
| 2, Commerce and people, 6–8 weeks | Orders, account finance, expenses, attendance and leave, approval workflows, WhatsApp | Order totals reconcile with real invoices to the paisa |
| 3, SaaS readiness, 6–8 weeks | Public API, audit, platform console, billing, SSO, store releases, penetration test | A tenant onboarded from the console in under a day |
| 4, Growth | Driven by customer demand | Not fixed in advance |

See [services.md](services.md) for the services each phase brings in.
