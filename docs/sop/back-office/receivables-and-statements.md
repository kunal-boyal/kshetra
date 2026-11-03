# Keep receivables and statements

| | |
|---|---|
| **Who** | Back office, Business head, Admin (`finance.manage` to record and import; `finance.view` to read, which Managers and Field users hold too) |
| **Where** | Web portal › **Accounts** › an account › **Finance**; **Reports** |
| **Module** | Account finance |
| **Related** | [Confirm collections](confirm-collections.md), [Import and export](imports-and-exports.md), [Reports](reports.md), [Process orders](process-orders.md) |

The product keeps no ledger of its own: what an account (the tenant's word, such as distributor or stockist) owes comes from your books. You load balances and ageing, statement entries, invoices and receipts, and the field sees each account's outstanding, ageing and credit on their phone. Once an account has invoices in the product, its outstanding and ageing are worked out from them; until then the latest balance you recorded is shown.

## Before you start

- Decide which way your books reach the product, and keep to it for each account: balances and ageing alone, or invoices and receipts. Invoices and receipts, once present, take over the account's figures.
- **Credit days when an invoice gives none** is on Settings › **Rules** › **Approvals** (default 30 days). The ageing buckets are your organisation's, by default 0–30, 31–60, 61–90, 91–180 and over 180 days.
- Account codes in your files must match the accounts' codes in the product.

## Steps

### Load from your books

Four kinds of record come from your books:

- **Balances and ageing**: each account's outstanding, credit limit, inventory value and ageing amounts on a date (no bulk route or connection brings these yet: record them on the account's **Finance** section);
- **Statement entries**: the account's ledger lines, a debit or a credit each;
- **Invoices**: invoice numbers, dates, due dates and amounts;
- **Receipts and credit notes**: what was received, naming the invoices it pays where your books do.

The portal's **Imports** page doesn't offer these yet: it offers people, territories, accounts, catalogue items, targets and account plans only. The server takes them as file imports and through the bulk API, so today they arrive through an [ERP connection](../admin/erp-connections.md) or an integrator's API client ([API clients and webhooks](../admin/api-clients-and-webhooks.md)). Send them after each day's or week's close, as your books allow.

Invoices and receipts are keyed by their number: sending a number again corrects that document. Statement entries are keyed by reference and only ever added.

### Read an account's Finance section

1. Open **Accounts**, choose the account, and go to **Finance**.
2. With invoices, it reads **From the invoices and receipts in your books, as of …**: **Outstanding** (with **After an advance of …** where one was paid), **Not yet due**, **Overdue** with **Oldest due …**, **Credit limit** with **… of the limit used**, and **Ageing** by bucket. **Open invoices** lists each **Invoice**, **Date**, **Due**, **Status** (**Not yet due** or **… days late**) and **Amount**; **Receipts** lists each **Receipt** or **Credit note** with what it settled.
3. Without invoices, it shows the latest balance: **Ledger from … · …**, **Outstanding** **as of …**, **Credit limit** or **No limit set**, **Inventory value** and **Ageing**. With none recorded yet, it says so.
4. Below, the **Statement** for a **Financial year**: **Opening balance**, each entry's **Date**, **Reference**, **Debit**, **Credit** and running **Balance**, and **Closing balance**. Choose **Print** to print it.
5. Collections not yet in the books show here too ([Confirm collections](confirm-collections.md)).

### Record a balance by hand

`finance.manage`, for an account whose books don't come by file.

1. Under **Record a balance**, give **As of**, **Outstanding**, the **Credit limit** if any, and the amount in each ageing bucket.
2. Choose **Record a balance**. It says **Saved.** Every balance is kept; the latest one shows.

### Add a statement entry

1. Under **Add an entry**, give the **Date**, **Reference**, **Description**, **Debit or credit** and **Amount**.
2. Choose **Add an entry**. Entries are never changed: to correct one, add a reversing entry.

### Read across accounts

On **Reports**, **Outstanding** lists what each account owes, aged; **Account statement** gives one account's statement for the year ([Reports](reports.md)).

## What the system checks

- Ageing buckets follow one another without overlapping, and the ageing amounts add up to no more than the outstanding, give or take 0.01 (BR-20, `bucketsIssue()`, `ageingIssue()`).
- Each statement entry is a debit or a credit, not both; the opening balance is the sum of everything before the year, and each line carries its running balance (BR-21, `entryIssue()`, `openingBalance()`, `runningBalances()`). A reference already entered is left as it is, and a changed one is refused.
- Receipts, oldest first, settle the invoices they name, in that order; what is left settles the oldest open invoices by due date. Cancelled documents take no part. Open invoices are aged by days past due; outstanding is open invoices less any advance (BR-51, `settleInvoices()`, `invoiceAgeing()`). This is worked out when read, never stored.
- An invoice without a due date is due after the credit days.
- What an account owes, after collections not yet in the books, decides an order's over-credit check.
- An imported document never moves to another account.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | A balance or entry breaks the rules above. | Fix the highlighted field. |
| No balance recorded yet. Balances come from your accounts software through an import, or are added below. | Nothing has been loaded for this account. | Send it from your books, or record a balance. |
| This feature is switched off for your organisation. | Account finance is switched off. | Ask your admin. |

## Waiting on the owner

- The ERP connectors (Zoho Books, SAP Business One, Tally) that bring invoices and receipts in by themselves haven't had a pass against a real system.
