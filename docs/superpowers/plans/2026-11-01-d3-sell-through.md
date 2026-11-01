# Phase 4 step D3: sell-through by item ("liquidation") — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** each month, for an account that holds stock, record a stock statement per item: what a distributor or retailer had, received, returned and still holds, and so what it sold through. It is captured on the phone at a visit or loaded by import and the bulk API. It is valued at the account's price list, feeds metrics, and has its own report.
- In code and the shared rules the record is "sell-through"; the agri template calls it liquidation through a new term, `term.sell_through`.
- Kunal's real sheet, when it comes, only checks column names and extras (D109's input for D3).

**Kunal's answers (2026-11-01), decision D124:**

| Question | Answer |
|---|---|
| Per item | A stock statement: opening, received, returned and closing. Sold-through = opening + received − returned − closing. Opening comes forward from last month's closing |
| Period | One statement per account per month. It can be changed during the month and its first days, and every change is kept |
| Value | Quantities are recorded and valued at the account's price list for the month. A new metric source sums value or quantity, and the agri template's liquidation metric switches to it |
| Review | A statement counts as soon as it is saved, and the manager sees it. Odd figures are flagged, never refused |

**Spec:** M10 (catalogue), M11, M18, 5.5, 5.7, BR-03, BR-10 to BR-12; D77, D96, D109. New: BR-53, `PERIOD_CLOSED`.

## Global constraints

- **Rules:** pure functions in `packages/shared/src/sell-through.ts` (BR-53), exact as decimal strings through `scaled()` and `unscaled()`:
  - `soldThrough({ opening, received, returned, closing })` gives the quantity sold, at numeric(18,3). It may be negative, and is then flagged.
  - `statementLineFlags(line, carried)` gives `negative_sold` (closing above opening plus received less returned) and `opening_changed` (opening differs from last month's closing carried forward).
  - `statementOpen(period, today)` holds while the month runs and for its first `SELL_THROUGH_GRACE_DAYS = 5` days after. A later change is refused with the new `PERIOD_CLOSED`.
  - `creditedDate(period, savedOn)`: the earlier of the day it was saved and the month's last day. The value belongs to whoever saved the statement's latest version, on that date (BR-03 for a month's record).
  - Fixtures FX-49 to FX-51 cover a statement carried forward, a negative sold-through, and a change in the first days of the next month.
- **Configuration:** account types gain `sellThrough: boolean` (default false), "accounts of this type report stock sold through, by item". In the agri template, distributor and retailer are on, and `term.sell_through` reads Liquidation in both languages. New permission `sell_through.record` (Core); the agri, building and FMCG field and manager roles get it, and each template's version goes up.
- **Tables** (all with RLS, keys led by `tenant_id`, and a cross-tenant fixture):
  - `cell.sell_through_statements`: `(tenant_id, id, account_id, period, version, recorded_by, recorded_at, credited_on date, value numeric(18,2) null, flags text[])`, unique `(tenant_id, account_id, period, version)`, indexed by `(tenant_id, period, account_id)`. It gets `rowVersionColumn()` for the phone.
  - `cell.sell_through_lines`: `(tenant_id, statement_id, item_id, opening, received, returned, closing, sold numeric(18,3), unit_price numeric(18,2) null, value numeric(18,2) null, flags text[])`, with primary key `(tenant_id, statement_id, item_id)`.
  - Each save is a new version, keeping the lines it doesn't change from the latest. The latest version counts.
- **Writes:**
  - `PUT /v1/accounts/{id}/sell-through/{period}` (`sell_through.record`, `idempotent()` keyed by the client's version ID). It takes the lines to set; lines left out keep their latest. The account must be one the caller reaches and of a type with `sellThrough`.
  - The import target `sell_through` (`sell_through.record` beside `import.run`), with columns Account code*, Month*, Item code*, Opening, Received*, Returned, Closing*. Each account-month in a file is one new version. It gets `example()` (D111) and the bulk route `/v1/bulk/sell-through`.
  - Both audit as `sell_through.recorded` and publish `sell_through.recorded` with the old and new credited dates, so metrics recompute both days.
- **Valuing:** each line's unit price is the account's price for the item on the credited date, through `applicableLists()` and `priceFor()` (D77), before tax. An item without a price has a null value and the flag `no_price`. Value = sold × unit price, exact to the paisa.
- **Reads:**
  - `GET /v1/accounts/{id}/sell-through?period=`: the latest version, with each line's carried opening, flags and value, and the versions (who saved each and when).
  - `GET /v1/accounts/{id}/sell-through/{period}/versions/{version}`: one earlier version.
  - Both within the account's reach.
- **Metric source:** `sell_through` in `@thelamp/metrics`, `{ measure: 'value' | 'quantity', items?: Key[] }` (item codes), additive. It is summed from the latest versions' lines by `SellThroughService.forMetrics()`, credited as above, and recomputed on `sell_through.recorded` in `performance.upkeep.ts`. The agri template's `liquidation` metric moves to `{ type: 'sell_through', measure: 'value' }`, and its distributor visit form drops the typed liquidation amount.
- **Report** `sell_through`: one row per account and item for the month, with the account's code, name and type, the item's code and name, opening, received, returned, closing, sold, unit price, value, flags, who recorded it and when. It is within scope through account reach (`report.view`), and joins the workbook on its own.
- **Phone:** the `sell_through` sync entity carries the latest version of each reached account's statements for this month and last. The account screen gains the term's action, opening `/sell-through/<accountId>`. Each item starts from last month's closing; the person types received, returned and closing and sees sold-through and the flags live with the shared rules. It saves offline as outbox kind `sell_through.save`.
- **Words:** English and Hindi.

## Review focus

1. **A change in the first days of the next month.** It is accepted, credited to the month's last day, and recomputes the old day and the new. After the fifth day it is refused with `PERIOD_CLOSED`. Tested.
2. **Two people saving the same account-month offline.** Both versions are kept, and the later one to reach the server is latest. Lines the later one didn't change come from the one before, so nothing is lost. Tested.
3. **An item without a price for that account.** The statement is saved with `no_price` and a null value; quantity metrics still count it. Tested.
4. **An account the caller can't reach, or of a type without sell-through.** It is refused with `OUT_OF_SCOPE` or `VALIDATION`, through the API, the import and the phone's upload. Tested.
5. **A metric for one item.** `items` limits the sum by item code; a code that matches no item sums nothing (metric checks have no catalogue to check codes against). Tested.

---

### Pull request 1: the rules, the server and the portal

#### Task 1: the rules and configuration

- `sell-through.ts` with FX-49 to FX-51, `PERIOD_CLOSED`, `sellThrough` on account types, the term, the permission (Appendix E), and the metric source with its checks.
- [x] Tests (unit).

#### Task 2: the server

- The migration.
- A `SellThroughService` in a new `sell-through` module: writes, versions, valuing and `forMetrics()`.
- The import target with `example()`, the reads, the event and its recompute, the report, the agri template (metric, form, account types, term and version), `pnpm openapi`, and the cross-tenant fixtures.
- [x] Tests (integration):
  - recording and carrying forward;
  - versions;
  - the grace days and `PERIOD_CLOSED`;
  - valuing, including without a price;
  - the import and the bulk API;
  - the metric for value and for one item;
  - the report and the workbook;
  - scope and type.

#### Task 3: the portal

- The account page gains a section titled with the term, shown for types with sell-through. It has the month's statement as a table with flags, a month stepper, and the versions (who and when, opening any one).
- The import screen lists the target.
- The metric editor offers the new source.
- [x] Tests (Vitest, and Playwright with axe).

### Pull request 2: the phone and the demo

#### Task 4

- The sync entity and its local table, the screen, and the outbox kind with its sender and label.
- The account screen's action.
- The agri demo records each distributor's and retailer's statement monthly, through `DemoKit`.
- [x] Tests:
  - Jest for the screen and the live sum;
  - `device.int.test.ts`: a statement saved offline syncs and counts;
  - demo content.

#### Task 5: finish

- [x] Decision D124, spec BR-53, M11 and Appendix B, `CLAUDE.md`, the progress row and tracker. `pnpm verify` before each merge.
