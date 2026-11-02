# Phase 4 step D6: distributor stock — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a tenant sees live stock at each distributor or stockist, item by item. Each tenant chooses where the stock comes from:

- **kept by the app:** a ledger of movements. Stock comes in when a primary order is fulfilled to the distributor and goes out when the distributor fulfils its retailers' secondary orders. Counts and entries correct it.
- **kept by the books:** stock levels loaded by file, the bulk API, or a distributor's own system. The app shows them and moves nothing.

Either way, people see a distributor's stock while ordering through it, on the account, and in reports.

**Kunal's answers (2026-11-02):**

- distributor stock first;
- the source chosen per tenant (the app, or the books).

He confirmed my recommendations the same day:

- account types opt in to holding stock;
- while the app keeps stock, fulfilment, counts and entries move it;
- a short secondary order is warned and flagged, never refused;
- a count adjusts stock at once, with big gaps flagged.

**Spec:** a new module M24 (Inventory), BR-62, fixtures FX-89 to FX-93, and decision D130. It changes spec 2.2, which today lists inventory management as out of scope for version 1. The new wording:

- distributor and stockist stock is in, as an opt-in module;
- company warehouse inventory, batches, expiry and stock valuation stay out;
- "accepting an order never moves stock" becomes "accepting an order never moves stock; fulfilling it moves the distributor's stock while the app keeps it".

## What exists to build on

- **Orders (D78):** an account with a parent is supplied by it (a secondary order); otherwise the company supplies it (a primary order). Accepted lines are fulfilled in base units (`POST /v1/orders/{id}/fulfilment`, `order.fulfil`).
- **Sell-through statements (D124, BR-53):** a monthly opening, received, returned and closing per item. They stay as they are, a monthly record that metrics read. While the app keeps stock, the phone pre-fills a new statement's received from the ledger.
- **Imports, the bulk API and the ERP connectors (D42, D94, D129):** a new import target reaches all three at once.

## Global constraints

### The module

- `inventory` is an opt-in module (`OPT_IN_MODULES`), off until the Modules page switches it on.
- **Its settings:** `stockSource` (`kept` or `books`, default `kept`) and `countTolerancePct` (default 5).
- **Its permissions:**
  - `stock.view`, for field people and up;
  - `stock.record`, for entries, counts and loads; back office and admins;
  - `stock.count`, for field people.
- **Which accounts hold stock:** account types opt in with `keepsStock`, like `sellThrough`. In the templates these are agri's and FMCG's distributors, pharma's stockists, and building materials' dealers.

### Data

All are tenant tables in `cell` with `tenant_id` and the isolation policy.

- `cell.stock_movements`, append-only (a correction is a reversing movement):
  - which account and item, signed base units (`numeric(18,3)`), and the day it counts on;
  - a kind: `opening`, `received`, `sold`, `returned_in`, `returned_out`, `counted` or `corrected`;
  - its source: an order line's fulfilment, a count, an entry or an import row, with a unique key so a source moves stock once.
- `cell.stock_levels`: on hand per account and item, with when it was last moved, counted or loaded. It is syncable (`row_version`).
  - While kept, the transaction of each movement updates it.
  - While books, each load replaces it.
- `cell.stock_counts` with their lines: counted, expected, the difference, and flags.

### Rules (BR-62)

Pure functions in `packages/shared/src/stock.ts`:

- `movementsFromFulfilment()`: a fulfilment's new base units per line become movements. For a primary order, `received` into the ordering account. For a secondary order, `sold` out of the supplying account. Each applies only if that account's type keeps stock. A fulfilment recorded again moves nothing more.
- `onHandAfter()`: the level after movements, exact to three places.
- `countResult()`: counted against expected becomes the difference, flagged past `countTolerancePct` or when stock would be negative.
- `stockShortfall()`: a cart's lines against the supplier's on hand. It names each line short and by how much.

### Never refusing in the field

Orders and counts are taken offline (D40), so stock never refuses one. A short order is flagged instead:

- on the line (`short_stock`);
- as an approval fact (`REQUEST_FACTS.short_stock`), so a tenant's chain can send it to someone;
- on the order page.

## Decisions for Kunal

Asked with this plan and answered as recommended (above):

1. Which accounts hold stock.
2. What moves stock while the app keeps it.
3. What a short secondary order does.
4. Whether a count changes stock at once.

Settled by these defaults unless Kunal says otherwise:

- **Quantities in base units, no costing.** Values are shown at the account's price list, as statements are, and nothing is a book value.
- **Reorder levels and suggested orders come later,** once real stock data shows what a sensible level is.

## Review focus

1. **Twice.** A fulfilment recorded twice, an import loaded twice, or a count sent twice from a phone moves stock once.
2. **Switching source.** Switching from kept to books keeps the ledger but stops it moving, and a load sets the levels. Switching back starts from the last load as an opening.
3. **Negative stock.** It is shown and flagged, never refused, never hidden.
4. **Reach.** People see the stock of the accounts they reach, on the web, the phone and in reports. Another tenant's account answers `NOT_FOUND`.
5. **Module off.** Routes answer `MODULE_DISABLED`, phones drop their copies, and fulfilment moves nothing.

---

### Pull request 1: the ledger, both sources, imports and reports (server)

- [x] The rules with FX-89 to FX-93; migrations; the module, settings, permissions and the `keepsStock` flag.
- [x] `StockService` (`apps/api/src/modules/stock`):
  - movements from the `order.fulfilled` event (an outbox consumer, idempotent by source);
  - entries;
  - counts, with their flags;
  - levels.
- [x] **Import targets:** `stock_movements`, for entries and a distributor's own sales; `stock_levels`, for loads while books and openings while kept. Both come with their bulk routes.
- [x] **Reports:** `stock_on_hand` (with value and last counted) and `stock_ledger` (a month's movements, counts' adjustments among them; counts themselves are read on the account).
- [x] Cross-tenant fixtures, `pnpm openapi`. Docs: D130, spec 2.2, M24, BR-62, CLAUDE.md, data classification. Integration tests.

### Pull request 2: the portal

- [x] A Stock section on the account page: levels with value, movements, Record goods in or out, Count stock, and the counts with their flags.
- [x] The module on the Modules page, and a Stock section on Settings › Rules (where stock comes from, the count tolerance), beside the other modules' rules rather than a page of its own. Account types take `keepsStock` from templates and configuration files, as `sellThrough` does.
- [x] The order desk and an order's page say where the supplier holds less than the order asks for (`SupplierShortfall`), against its stock now; the flag kept on the order itself comes with part 3.
- [x] Vitest, Playwright with axe, strings in English and Hindi.

### Pull request 3: the phone and the demo

- [x] The `stock` sync entity (one row an account), scoped by reach.
- [x] Stock on the account screen; the cart shows the supplier's stock and short lines. The short-stock flag kept on the order's lines (`short_units`) and the `short_stock` approval fact.
- [x] Counting at `/stock-count/<accountId>`, queued as `stock.count`.
- [x] The sell-through statement pre-filled from the ledger: a follow-up pull request, the month's movements carried on each synced item.
- [x] Demo content: openings, receipts and sales from fulfilment, and a count a week.
- [x] Jest. Progress and the tracker. `pnpm verify` before each merge.
