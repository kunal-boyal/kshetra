# Phase 4 step D7: collections — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a field person records the money they take from an account (cash, UPI, cheque or bank transfer) on the phone, offline, against what the account owes. The office confirms it, and it counts toward the person's collection metric. Until the books' own receipt arrives, the account shows it as collected but not yet in the books.

**Why now:** collections are the first of the prototype features phase U left out (D104, D131). The prototype's `AppCollect` and `WebFinance` boards show it. Today a collection is only a currency field on a visit form (D79): the app knows nothing of the mode, nothing waits for the office, and nothing ties the amount to an invoice.

**Spec:** BR-63 and fixtures FX-95 to FX-99 in module M11 (account finance), and decision D132. **Spec 2.2 stays as it is:** collections are a field record, never a ledger. A collection never becomes a receipt in the register. The books' receipts still come only from imports, the bulk API and the connectors (D121, D129).

## What exists to build on

- **Receivables (D121, BR-51):**
  - `cell.invoices` and `cell.receipts` hold the books' records;
  - `settleInvoices()` and `invoiceAgeing()` work out what is open;
  - `ReceivablesService.receivables()` gives an account's outstanding;
  - `writeReceipts()` is the one place receipts are written, from imports, the bulk API and every connector.
- **The phone (D79):**
  - the `balances` sync entity and `useBalance()`;
  - `useOpenInvoices()`, which reads online;
  - the account screen already shows what the account owes.
- **Already in place:** photos (D44), the outbox (D40), metrics (D56), reports (D62), webhooks (D94) and notifications (D58).

## Decisions (Kunal chose every recommendation on 2026-11-02)

1. **Collections and the books.**
   - *Recommended:* collections stand beside the books. When a receipt is written for the same account and the same amount, dated on the collection's day or up to 30 days after, it matches the oldest open confirmed collection, which becomes `in_books`. The office can match or unmatch one by hand.
   - The account then shows three figures: its outstanding (the books'), collected but not yet in the books, and what is left after them.
   - *Instead:* a confirmed collection writes a receipt into the register at once. This makes the app a ledger (spec 2.2), and the books' own receipt would count twice.
2. **Who confirms.**
   - *Recommended:* back office and admins, with a new `collection.confirm`, on the portal's Collections page. They confirm one at a time or in bulk, reject with a reason, and mark a confirmed cheque bounced.
   - *Instead:* a `collection` request type in the approval chains and the inbox; or no confirmation at all, counting a collection once recorded.
3. **The shop owner's receipt.**
   - *Recommended:* once saved, the phone offers Android's share sheet with the receipt as text, clearly marked "awaiting the office's confirmation". The portal prints one with `Printable`. A message sent by the server waits for the WhatsApp provider (D85).
   - *Instead:* no receipt yet.
4. **Metrics and the templates.**
   - *Recommended:* a new metric source, `collected`. It sums the collector's collections by their date, leaving out rejected and bounced ones. The templates (raised a version) take their collection metric from it, and their visit forms drop the collection amount.
   - Existing tenants keep their forms and metric until an admin changes them. The metric editor offers the new source.
   - *Instead:* add the source, but leave the templates alone.

## Global constraints

### Rules (BR-63, pure functions in `packages/shared/src/collections.ts`)

- **What a collection records:**
  - an amount above zero, exact as paise;
  - a mode: `cash`, `upi`, `cheque` or `bank_transfer`;
  - the day on the tenant's clock, never in the future.
- **References by mode** (`collectionIssues()`):
  - a cheque needs its number, bank and date, plus a photo of the cheque;
  - UPI and bank transfers need their reference;
  - cash needs none.
- **The cash limit:** cash of ₹2,00,000 or more from one account on one day is refused (section 269ST of the Income-tax Act). This is the `collectionCashLimit` setting, default `200000`; `null` turns it off.
- **Status** (`collectionStatusIssue()`):
  - `recorded` becomes `confirmed` or `rejected`;
  - `confirmed` becomes `bounced` (cheques only) or `in_books`;
  - `in_books` goes back to `confirmed` only when unmatched;
  - a rejection or a bounce needs a reason;
  - nobody confirms, rejects or bounces their own collection.
- **Matching** (`matchReceipts()`): each receipt not yet linked takes the oldest `confirmed` collection of its account with the same amount, dated on or up to 30 days before the receipt. One receipt matches one collection.
- **The account's figures** (`collectedNotInBooks()`):
  - collected but not yet in the books is `recorded` plus `confirmed`;
  - what is left after them is outstanding less that sum, never below zero.
- **The preview** (`collectionPreview()`): which open invoices a collection would settle, oldest first, worked out with `settleInvoices()` with the collection as a receipt. Shown on the phone; never stored.

### Data (tenant tables in `cell`, `tenant_id`, isolation policy, `(tenant_id, id)` keys)

- **`cell.collections`:**
  - the ID, given on the device;
  - account, collector, day, amount, mode, reference, cheque number, bank and date, and the optional visit;
  - the capture point and whether it is in the geofence (a flag, never a refusal);
  - status, with reason and decider and when;
  - the matched receipt's ID, and a number per tenant (`COL-000123`);
  - `row_version`, so it can sync.
- **Photos:** media kind `collection`, owned by the collection (`PhotosService.forRecord()` and `attach()`), with evidence retention.

### Permissions (module `account_finance`)

- **`collection.record`:** field people and up.
- **`collection.view`:** managers see their reach; field people their own.
- **`collection.confirm`:** back office and admins.
- **API clients:** reading collections through `finance:read`, deciding and matching through `finance:write`.
- **Templates:** the agri, FMCG, pharma, building and generic templates grant them, each raised a version.

### Everywhere

- **Audit:** `collection.recorded`, `.confirmed`, `.rejected`, `.bounced`, `.matched` and `.unmatched`.
- **Events:** `collection.recorded` and `collection.status_changed`. Webhook events `collection.confirmed` and `collection.bounced` carry IDs, amounts and statuses only.
- **Strings:** all in English and Hindi. Money goes through `formatMoney`.

## Review focus

1. **A phone sends the same collection twice:** it applies once, through `idempotent()` keyed `collection:<id>`.
2. **A receipt of the same amount arrives before the collection is confirmed:** it doesn't match. It matches once the collection is confirmed, at the next receipt write or when matched by hand.
3. **Two collections of the same amount at one account:** the oldest matches first. The second waits for its own receipt.
4. **Cash split across two collections on the same day passes the limit together:** the second is refused.
5. **A collection rejected after a metric counted it:** the collector's day is worked out again.

## Part 1 (one pull request): the server

- [ ] Write the rules in `packages/shared/src/collections.ts`, with their zod schemas in `schemas/collections.ts`, and tests FX-95 to FX-99:
  - the checks by mode and the cash limit;
  - the status moves and own-record refusals;
  - matching, oldest first, within 30 days;
  - collected but not yet in the books;
  - the settlement preview.
- [ ] Add the migration: `cell.collections`, the `collection` media kind, the numbering sequence per tenant, and grants.
- [ ] Add `CollectionsService` (`apps/api/src/modules/finance/collections.service.ts`):
  - `record()` (idempotent, evidence checked, the cheque photo attached);
  - `decide()` (one at a time, or many, each in a savepoint);
  - `bounce()`, `match()` and `unmatch()`;
  - `list()` within the caller's scope;
  - `notInBooks(accountIds)`.
  - After every write, `ReceivablesService.writeReceipts()` calls `match()` for the accounts it touched.
- [ ] Add the routes, each with `@Contract`, a cross-tenant fixture, and the regenerated `pnpm openapi`:
  - `POST /v1/collections`;
  - `GET /v1/collections` (status, account, person, month);
  - `GET /v1/collections/{id}`;
  - `POST /v1/collections/decisions`;
  - `POST /v1/collections/{id}/bounce`;
  - `POST /v1/collections/{id}/match` and `/unmatch`.
- [ ] Extend the account's finance:
  - `GET /v1/accounts/{id}/finance` and `receivables()` gain `collectedNotInBooks` and `leftAfterCollections`;
  - the `balances` sync row carries them too, as version 2;
  - so do `OrderCredit` and the `outstanding` report.
- [ ] Add the metric source `collected` (`DayRecords.collections` from `forMetrics()`, its calculator in `calculate.ts`, added to `COMPUTED_SOURCES`). `performance.upkeep.ts` recomputes the collector's day on `collection.recorded` and `collection.status_changed`.
- [ ] Add the `collections` report: a register with mode, reference, status, decider and matched receipt.
- [ ] Add notifications to the collector on rejection and bounce (`notify.collection_rejected`, `notify.collection_bounced`), and the webhook events.
- [ ] Add the `collections` sync entity:
  - the person's own collections from the last 60 days;
  - every unmatched collection at the accounts they reach, scoped by reach;
  - its local table in a new local migration.
- [ ] Update the templates and the demo:
  - the permissions, the `collected` metric, and the visit forms without a collection amount;
  - `DemoCommerce` collects on some visits, and the evening confirms most of them and rejects one.
- [ ] Write the integration tests (`test/collections.int.test.ts`): record, replay, refusals by mode and cash limit, own decisions refused, bulk decisions with one refused, matching through a receipts import and through the bulk API, unmatching, the metric moving on rejection, scope, and the module switched off.

## Part 2 (one pull request): the portal

- [ ] Add the Collections page (`apps/web/src/finance/collections-page.tsx`, in the rail under Finance, for `collection.view`):
  - tiles: waiting to confirm, confirmed this month, not yet in the books, bounced;
  - tabs: Waiting and All;
  - a `DataTable` with bulk confirm, reject with a reason (`Confirm` in place), bounce, match and unmatch;
  - the cheque photo opened from the row.
- [ ] Add a collection's page, with a `Printable` receipt and `PrintButton`.
- [ ] Extend the account's Finance section: collected but not yet in the books, what is left after it, and the account's recent collections.
- [ ] Add the setting `collectionCashLimit` on Settings › Rules.
- [ ] Write Vitest tests per screen, and a Playwright test with axe.

## Part 3 (one pull request): the phone

- [ ] Add the Collect payment screen `/collect/<accountId>` (`src/screens/collect.tsx`, with the hooks in `src/collections.ts`), offline. It follows the prototype's `AppCollect`:
  - outstanding, not due and overdue, from the synced balance;
  - the open invoices and the "settles INV-… first" preview when online;
  - the amount, the mode as chips, and the references by mode;
  - a cheque photo through `/camera?kind=collection`;
  - a hint while over the cash limit;
  - Save queues `collection.create` (after the visit's check-in when in one).
- [ ] After saving, offer Share receipt (React Native's built-in `Share`; no new dependency).
- [ ] Reach it from the account screen and the visit card, each showing "₹… outstanding · ₹… overdue".
- [ ] Add My collections under More: status, with the rejection or bounce reason.
- [ ] Show collected but not yet in the books on the account screen.
- [ ] Write Jest tests per screen.
- [ ] Update the store answers if the data types change. A cheque photo is a photo already declared, so no change is expected.

## Docs, in each pull request as it applies

Update the spec (M11, BR-63, FX-95 to FX-99, Appendix E permissions), the D132 row, CLAUDE.md's finance section, `docs/progress.md` and the tracker.
