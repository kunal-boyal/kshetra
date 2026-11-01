# Phase 4 step D4: invoice and receipt registers — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** invoices and receipts as dated documents from the customer's books, loaded by import and the bulk API first. An account's outstanding and ageing are worked out from its open invoices. The account's finance shows the registers, and an outstanding report covers the team (D96, with the report D86 deferred). The product keeps no ledger of its own; these are the customer's documents (spec 2.2).

**Kunal's answers (2026-11-01), decision D121:**

| Question | Answer |
|---|---|
| Settling | A receipt settles the invoices it names, in the order named. Whatever it leaves settles the account's oldest open invoices first, by due date, then invoice date, then number |
| Source | Once an account has any invoice, its outstanding and ageing come from its invoices. Accounts without invoices keep their snapshots. The credit limit still comes from the latest snapshot |
| Corrections | A document sent again with the same number and the same content changes nothing. Changed content updates it, audited before and after. A cancelled document leaves the ageing but stays on the register |
| Due date | When an invoice gives no due date: its date plus the credit days it gives, else the new setting `defaultCreditDays` (0–365, default 30) |

**Spec:** M11, BR-20, BR-21, Appendix B (imports); D79, D86, D96. New: BR-51.

## Global constraints

- **Rules:** pure functions in `packages/shared/src/receivables.ts`, exact as paise through `scaled()` and `unscaled()`.
  - `invoiceDueDate(date, creditDays)`.
  - `settleInvoices(invoices, receipts)`: settles bill-wise, then oldest first. It gives each invoice's open amount, and any advance (receipts beyond every invoice). Cancelled documents take no part.
  - `invoiceAgeing(open, buckets, asOf)`: gives outstanding, not yet due, overdue, ageing by the tenant's buckets (`ageingBuckets`, BR-20) by days past due on `asOf`, and the oldest overdue due date. Outstanding is the open invoices less any advance.
  - Fixtures FX-42 to FX-45: bill-wise and oldest-first settling, an advance, and a cancelled invoice.
- **Tables:** both have RLS, keys led by `tenant_id`, a cross-tenant fixture, and `rowVersionColumn()`.
  - `cell.invoices`: `(tenant_id, id, account_id, number, date, due_date, amount numeric(18,2), cancelled boolean, source, import_id, created_by, created_at, updated_by, updated_at)`. Unique `(tenant_id, number)`; index `(tenant_id, account_id, due_date)`.
  - `cell.receipts`: `(tenant_id, id, account_id, number, date, amount, kind 'receipt'|'credit_note', against text[], cancelled, …)`, where `against` holds the invoice numbers it pays. Unique `(tenant_id, number)`.
- **Corrections:** the invoices and receipts import plans each row as new, unchanged, changed or refused. A document never moves to another account; that row is refused. Audit actions:
  - `invoice.recorded`, `invoice.changed`, `invoice.cancelled`;
  - `receipt.recorded`, `receipt.changed`, `receipt.cancelled`.
- **Imports** (register through `ImportTargets`, each with `example()`, D111; the bulk API then serves `/v1/bulk/invoices` and `/v1/bulk/receipts`):
  - `invoices`: Invoice number*, Account code*, Invoice date*, Amount*, Due date, Credit days, Status (open or cancelled).
  - `receipts`: Receipt number*, Account code*, Receipt date*, Amount*, Kind (receipt or credit note), Against invoices (numbers separated by `;`), Status.
  - Both need `finance.manage`; their field names go in the web's `fieldName` and the strings.
- **Reads** (`finance.view`, within the caller's account reach, `account_finance` module):
  - `GET /v1/accounts/{id}/invoices?status=open|all` (paged): each invoice with its open amount, days past due, and the receipts that settled it.
  - `GET /v1/accounts/{id}/receipts` (paged).
  - `GET /v1/accounts/{id}/finance` gains `receivables`: outstanding, not due, overdue, ageing, oldest due date and advance, when the account has invoices. `FinanceService.summary()` gives this to the account view, the order credit check (`OrderCredit`) and the phone.
- **Report** `outstanding`:
  - columns: the account's code, name and type; where its figures come from; as of; credit limit; outstanding; not due; one column per ageing bucket; oldest due date; last receipt and its date;
  - `REPORT_PERMISSION` `finance.view`, `REPORT_MODULE` `account_finance`, as of the month's end, or today in the month under way;
  - accounts with snapshots only show their latest snapshot, marked by a source column;
  - it joins the workbook on its own (D112).
- **Words:** English and Hindi.

## Review focus

1. **A receipt naming an invoice already settled:** what it can't apply goes oldest first. A receipt naming an unknown number is accepted and settles oldest first (the import framework has no warnings). Tested.
2. **A cancelled invoice that a receipt named:** the receipt's amount goes oldest first, then becomes an advance if nothing is open. Tested.
3. **An invoice sent again changed:** it updates once, audited; the same content changes nothing; a different account is refused. Tested.
4. **Credit:** an order is over credit by the invoice-based outstanding when the account has invoices. Tested.
5. **Scale:** the outstanding report reads a page of accounts with their open documents in a few queries, not one per account, and runs on the replica (D98). Tested with 200 accounts.

---

### Task 1: the rules

- `receivables.ts`, FX-42 to FX-45, and the `defaultCreditDays` setting.
- [x] Tests (unit).

### Task 2: the server

- Migration 0087 for the two tables.
- `ReceivablesService` in the finance module, the two import targets, the reads, `summary()`, the credit source, the `outstanding` report; `pnpm openapi`.
- [x] Tests (integration):
  - importing each, with corrections and cancellations;
  - settling through the reads;
  - the bulk API;
  - credit from invoices;
  - the report and the workbook;
  - scope;
  - module off;
  - the cross-tenant fixtures.

### Task 3: the portal (pull request 1)

- The account page's finance shows outstanding and ageing from invoices, with "Open invoices" and "Receipts" lists, each paged (D106).
- The imports list the two targets.
- Settings › Rules gains "Credit days when an invoice gives none".
- [x] Tests (Vitest and Playwright with axe).

### Task 4: the phone (pull request 2)

- The `balances` sync entity carries the invoice-based outstanding and ageing. Its rows move whenever an account's invoices or receipts change (the latest `row_version` of the three tables), and its version is raised.
- The account screen lists open invoices, read online.
- [x] Tests (Jest), and the balances sync test in `finance.int.test.ts` keeping a balance that an invoice, then a receipt, changed.

### Task 5: finish

- [x] Decision D121, spec M11 and BR-51, `CLAUDE.md`, the progress row and tracker; `pnpm verify` before each merge.
