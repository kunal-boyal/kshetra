# Progress

This file tracks where the build stands against the delivery phases in spec section 15. Update it in the same pull request as every step, so it never drifts from the code.

Last updated: 2026-10-07

## Now

- **Phase 0 is complete.** Steps 1 to 11 are merged; the last three were the web shell (#11), the mobile shell (#12) and the cross-tenant contract test with the exit check (#13). Every exit criterion is checked by a test: a person signs in on the web into either seeded tenant and a field user on a phone, the cross-tenant contract test passes over all 27 routes, and both templates validate. The field app has run in a browser standing in for a phone; Kunal's phone comes next.
- **Decisions D35, D36 and D37** are merged as proposed and wait for Kunal to confirm them; D36's choice of font on Android is decided (D38).
- **Phase 1 is in progress** (decision D38). Steps 1 and 2 are merged: background work ([kunal-boyal/kshetra#15](https://github.com/kunal-boyal/kshetra/pull/15), decision D39) and offline sync ([kunal-boyal/kshetra#16](https://github.com/kunal-boyal/kshetra/pull/16), decision D40). Step 3, people on the web, is merged too ([kunal-boyal/kshetra#17](https://github.com/kunal-boyal/kshetra/pull/17), decision D41). Step 4, imports and territories, is in review as [kunal-boyal/kshetra#18](https://github.com/kunal-boyal/kshetra/pull/18). Its design is decision D42.
- **Next:** phase 1, step 5: accounts.
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
| 9 | Web shell with sign-in: `apps/web`, `packages/ui-web`, `packages/api-client`, the token build step (D35) | Done | #11 |
| 10 | Mobile shell with sign-in: `apps/mobile` (Expo, on the account `kunalboyal`, D34), `packages/ui-mobile`, the minimum app version (D36) | Done | #12 |
| 11 | Cross-tenant contract test over every route, the route registry and OpenAPI document, and the phase 0 exit check (D37) | Done | #13 |

## Phase 1: Field core, the MVP

The spec plans 8–10 weeks for this phase. Kunal approved this plan, and the start of phase 1, on 2026-10-06 (decision D38).

**Exit criteria:**
- one tenant runs a pilot week: punch-in, tracking, planned and ad hoc visits with photos, review, metric and leaderboard updates, and imports that reconcile with the source files
- the device protocol passes on two Android brands

Each step is its own pull request, in this order. Each needs from Kunal what its row says before it starts.

| Step | Capability | Needs from Kunal | Status | Pull request |
|---|---|---|---|---|
| 1 | Background work: worker and scheduler processes with BullMQ queues, tenant-local schedules; the outbox relay moves into the worker (spec 12.3, D39) | | Done | #15 |
| 2 | Offline sync: pull with cursors and tombstones, the app's SQLite store and push outbox, the upload queue screen, the config bundle offline, the device heartbeat (spec 11.3, D40) | | Done | #16 |
| 3 | People on the web: users (create, edit, deactivate, transfer, reset device, sign out everywhere), the org chart, device health, roles and designations, custom user fields (M3, M2, D31, D41) | | Done | #17 |
| 4 | Imports and territories: the import framework, user and territory imports, territory tree screens (M19, M4) | | In review | #18 |
| 5 | Accounts: types, slots, visibility, geofence, contacts, segments, the account overview and import, the app's offline list, proposals of new accounts and locations, approved by the proposer's manager until phase 2 (M4, D38) | | To do | |
| 6 | Photos: camera capture, presigned uploads, processing with duplicate checks, signed reads (spec 12.2) | | To do | |
| 7 | Forms: versioned definitions, the app's renderer for every version 1 field type with drafts, the web form builder, and the item import without prices (spec 5.6, D38) | | To do | |
| 8 | Shifts and tracking: consent, punch-in and punch-out offline, background location, ingest, pauses, auto-close, compaction, attendance days (M5, spec 12.1) | EAS development builds; two Android phones of different brands | To do | |
| 9 | Visits and activities: check-in and check-out with the geofence, submissions with evidence and flags, standalone activities (M6) | | To do | |
| 10 | Evidence review: the queue, decisions, bulk and auto-approval (M7) | | To do | |
| 11 | Planning: routes, plan items and their statuses, targets (lock, copy, import), account plans, today's plan on the app (M8) | | To do | |
| 12 | Metrics and performance: the metric engine, scores, ranks, leaderboards, My month tiles (spec 12.5, M9) | | To do | |
| 13 | Notifications: push, in-app, SMS fallback, the morning plan, tracking-stopped alerts (M16) | An SMS provider with DLT; a Firebase project for push | To do | |
| 14 | Maps: live map, day replay, visit density (M17) | Google Maps API keys | To do | |
| 15 | Dashboards, reports and exports: home dashboards, the activity log, the attendance register, target against achievement, export jobs (M18) | | To do | |
| 16 | Tenant administration: settings, terminology and modules screens, branding with the derived accent, configuration export and import (M2) | | To do | |
| 17 | Pilot readiness and the pilot week: a deployed cell on AWS, the delivery pipeline, Play internal testing, Maestro in CI, the device protocol, the pilot week (spec 14, 15) | AWS and Play Console accounts; D1 and D2 | To do | |

## Done

| Date | What | Where |
|---|---|---|
| 2026-10-12 | Phase 1 step 3: people on the web, custom user fields, dated transfers, the organisation chart and history (decision D41) | PR #17, merged as `34e2b08` |
| 2026-10-07 | Phase 1 step 2: offline sync, the phone's database and outbox, and the device heartbeat (decision D40). GitHub refused writes for a while, so the merge commit was pushed from a checkout with GitHub's own message. | PR #16, merged as `a161935` |
| 2026-10-07 | Phase 1 step 1: background work, the worker and scheduler processes (decision D39) | PR #15, merged as `c1c83ee` |
| 2026-10-06 | Kunal approved the phase 1 plan and started phase 1, and decided how proposals are approved before phase 2, that the item import joins phase 1, and the font on Android (decision D38) | `docs/decisions.md`, this file |
| 2026-10-06 | Phase 0 complete: every exit criterion is checked by a test | PRs #11 to #13 |
| 2026-10-06 | Phase 0 step 11: the route registry, the cross-tenant contract test, the OpenAPI document and the exit check (decision D37) | PR #13, merged as `fa1e876` |
| 2026-10-06 | Phase 0 step 10: the mobile shell with sign-in, device binding and the minimum app version (decision D36) | PR #12, merged as `1183eff` |
| 2026-10-06 | Phase 0 step 9: the web shell with sign-in (decision D35) | PR #11, merged as `41ee391` |
| 2026-10-06 | The EAS project `@kunalboyal/kshetra` created for the field app | https://expo.dev/accounts/kunalboyal/projects/kshetra, decision D34 |
| 2026-10-06 | Kunal created the Expo account `kunalboyal` and signed in to EAS; it owns the mobile app's project (decision D34) | `docs/decisions.md` |
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
| Confirm decisions D35 (the web shell), D36 (the mobile shell) and D37 (the contract test and the OpenAPI document), merged as proposed; D36's font choice is decided (D38) | Kunal | Before phase 1 builds on them |
| Confirm decision D39 (background work), merged as proposed in #15 | Kunal | Before phase 1 builds on it |
| Confirm decision D40 (the mobile sync), merged as proposed in #16. It changed how row versions work, and spec 10.1 and 11.3 with them | Kunal | Before phase 1 builds on it |
| Confirm decision D41 (people on the web), merged as proposed in #17: custom user fields, transfers, the organisation chart and history | Kunal | Before phase 1 builds on it |
| Review decision D42, imports and territories, in #18: the object store arriving early, uploads as the request body, all-or-nothing commits, and how names are matched (BR-42) | Kunal | Before #18 merges |
| Decide how the API's problem and field-error texts reach Hindi readers: today they are English, while the screens around them are translated (D42) | Kunal | Before the pilot |
| Try the field app on your phone: Expo Go (`pnpm --filter @kshetra/mobile go`, then scan the code), or a development build from EAS, which runs in Expo's cloud on your account and needs your go-ahead | Kunal | Early in phase 1 |
| Accounts with long lead times: SMS provider with DLT, Google Play and Apple (each needs a D-U-N-S number), AWS | Kunal | Phase 1 |
| Outdoor theme field test, on two Android brands in midday sun (D19) | Team | Before onboarding suggests Outdoor |
| Look over the soft pastel design system (D28) in the running web portal (`pnpm dev`): the hues, how round, and how fast the motion is | Kunal | Before phase 1 builds more screens on it |
| Confirm the template starting points: default role permissions (D26), leave types, and the agri expense rates (D27) | Kunal | Before the pilot |
| Have a native speaker review the Hindi text in both templates and in `packages/i18n` | Kunal | Before the pilot |

## Later phases (spec section 15)

| Phase | Scope | Exit criteria |
|---|---|---|
| 2, Commerce and people, 6–8 weeks | Orders, account finance, expenses, attendance and leave, approval workflows, WhatsApp | Order totals reconcile with real invoices to the paisa |
| 3, SaaS readiness, 6–8 weeks | Public API, audit, platform console, billing, SSO, store releases, penetration test | A tenant onboarded from the console in under a day |
| 4, Growth | Driven by customer demand | Not fixed in advance |

See [services.md](services.md) for the services each phase brings in.
