# Phase 4 step D2: product forecasts per account — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** each account's expected quantity per item for the coming months, entered by whoever holds the account on the phone (offline) or the portal, or loaded by import and the bulk API. It is kept as versions, locked as each month begins, and set against what the account actually ordered and sold through, and against its account plan.

**Kunal's answers (2026-11-01), decision D126.** He confirmed my recommended design in place of an example of his own, which a customer's real practice will check later:

| Question | Answer |
|---|---|
| Horizon | The next 3 months, rolling |
| Who enters it | The field person who holds the account, on the phone or the portal; back office by import or API |
| Locking | Each month locks on its 1st, and every earlier change is kept as a version. After the lock, a manager may still change it, with a reason |
| Compared with | The account plan, orders and sell-through, in a gap and accuracy report |

**Spec:** M8 (account plans), M10, M18; D55, D96, D124. New: BR-54.

## Global constraints

- **Rules:** pure functions in `packages/shared/src/forecasts.ts` (BR-54):
  - `forecastMonths(today)` gives the three months after today's.
  - `forecastOpen(period, today, override)`: a month is open until its 1st, and after that only with the override (`forecast.adjust`) and a reason.
  - `forecastAccuracy(lines)` is weighted: 1 − Σ|actual − forecast| ÷ Σforecast, never below 0, and null when nothing was forecast.
  - `forecastGap(forecast, actual)` gives quantity and share.
  - Fixtures FX-52 to FX-54: the window across a year's end; a lock with and without the override; accuracy over items with misses both ways.
- **Permissions:** `forecast.record` (Core) for field people, managers, business heads and admins in every template, and `forecast.adjust` for managers, business heads and admins. Existing admins get both by migration, and each template's `version` goes up.
- **Tables** (all with RLS, keys led by `tenant_id`, a cross-tenant fixture, and `rowVersionColumn()` on forecasts):
  - `cell.forecasts`: `(tenant_id, id, account_id, period, version, recorded_by, recorded_at, reason null, after_lock boolean)`, unique `(tenant_id, account_id, period, version)`.
  - `cell.forecast_lines`: `(tenant_id, forecast_id, item_id, quantity numeric(18,3))`, with primary key `(tenant_id, forecast_id, item_id)`.
  - Versions are only added, the latest counts, and each save keeps the items it doesn't change, as in D124.
- **Writes:**
  - `PUT /v1/accounts/{id}/forecasts/{period}` (`forecast.record`, idempotent by the client's version ID). It takes items with quantities; a quantity of 0 drops the item. A locked month needs `forecast.adjust` and a `reason`.
  - The `forecasts` import (Account code*, Month*, Item code*, Quantity*), with `example()`, and `/v1/bulk/forecasts`.
  - Writes audit as `forecast.recorded`.
- **Reads:**
  - `GET /v1/accounts/{id}/forecasts?from=&to=`: the latest version of each month, with the versions.
  - The report `forecast_accuracy` for a month. For each account and item it shows forecast, ordered (accepted and fulfilled base units from orders while that module is on), sold through (from D124, where the account gives statements), the gap and accuracy, and each account's accuracy. Within the account reach.
- **Against the account plan:** a new setting `forecastPlanMetric` names a currency metric (null by default). Where it is set, the report adds each account's forecast value, priced at its price list on the month's 1st, beside its account plan for that metric.
- **Phone:** the `forecasts` sync entity carries the latest versions for this month and the next three, for accounts the person sees. `/forecast/<accountId>` shows the three months with each item's quantity, saves offline as `forecast.save`, and shows a locked month read only. It opens from the account screen.
- **Portal:** the account page's Forecast section shows the months, items and versions, and lets someone with `forecast.record` edit. The imports list the target, and the report sits in Reports.
- **Demo:** each agri, FMCG and building demo field person forecasts their held accounts for the coming months, a few items each.
- **Words:** English and Hindi.

## Review focus

1. **The year's end.** In December the window is January to March of the next year, and accuracy reads across it. Tested.
2. **A change after the 1st.** It is refused without `forecast.adjust`; with it and a reason, it is kept and marked `after_lock`. Tested.
3. **Two saves offline.** Each is a version and nothing is lost, as in D124. Tested.
4. **Nothing forecast.** Accuracy is null rather than 100% or 0%, and an item that was ordered but never forecast counts in the gap. Tested.
5. **Orders module off.** Ordered quantities are left out and the report says so. Tested.

---

### Pull request 1: the rules, the server and the portal

- [x] Rules and fixtures; permissions and templates; the migration (including the existing admins); `ForecastsService` in a new `forecasts` module; the routes, import, bulk route and report; the setting; `pnpm openapi`; cross-tenant fixtures.
- [x] Tests:
  - unit;
  - integration: recording, versions, the lock and its override, the import and bulk route, the report with and without orders, the plan comparison, and scope;
  - Vitest and Playwright with axe for the account section and the report.

### Pull request 2: the phone and the demo

- [ ] The sync entity and local table, the screen, the outbox kind, the account screen's row, and the demo.
- [ ] Tests: Jest, the `device.int.test.ts` round trip, and demo content.
- [ ] Decision D126, spec BR-54, M8 and Appendix B, `CLAUDE.md`, the store answers, progress and tracker. `pnpm verify` before each merge, with the local services stopped.
