# Keep distributors' stock

| | |
|---|---|
| **Who** | Back office, Business head, Admin (`stock.record`); anyone with `stock.count` counts (Field user and Manager too); `stock.view` to read |
| **Where** | Web portal › **Accounts** › an account › **Stock**; **Reports** |
| **Module** | Inventory (off until an admin switches it on) |
| **Related** | [Process orders](process-orders.md), [Import and export](imports-and-exports.md), [Reports](reports.md) |

The product can know what stock each stock-holding account (a distributor or stockist, in the tenant's words) has, item by item. Either the app keeps a ledger that fulfilment, counts and your entries move, or your books' levels are loaded and nothing else moves them. Your company's own stock isn't kept.

## Before you start

- An admin switches **Inventory** on in Settings › **Modules**; it ships off.
- Only account types marked to keep stock hold it; the **Stock** section shows only on their accounts.
- Settings › **Rules** › **Where stock comes from** decides the source: **Kept by the app** or **Loaded from the books**. **A count is flagged past this difference (%)** sets when a count draws a second look.

## Steps

### Read an account's stock

1. Open **Accounts**, choose the account, and go to **Stock**. It says where the stock comes from: **Kept by the app: fulfilment, counts and entries move it.** or **Loaded from your books; nothing here moves it.**
2. The table gives each **Item**, **On hand** (**Below zero** where the ledger has gone negative), **Value**, **Last moved** and **Last counted**, and the total, **Worth … at its prices**.
3. Below, **Movements** lists each **Date**, **Kind**, **Item**, **Quantity**, **From** and **By**; **Counts** lists each count, with **Flagged** where it was far from what was expected.

### Record goods in or out

While the app keeps stock.

1. Choose **Record goods in or out**.
2. For each line, choose the **Item** (**Choose an item**) and the **Kind**: **Opening**, **Received**, **Sold**, **Returned in**, **Returned out** or **Correction**.
3. Give **Quantity, in base units**; for a correction, **Change, in base units; less is negative**.
4. Give the **Date** (today when left empty) and any **Note**. **Add an item** adds a line; **Remove line …** takes one out.
5. Choose **Save**.

A mistake is put right with another movement, a correction: movements are never changed or removed.

### Count stock

1. Choose **Count stock**. Write what is there; items left empty aren't counted.
2. Give **Counted, in base units** for each item, then **Save the count**.
3. While the app keeps stock it says **Count saved. Stock is set to it.**; with stock from the books, **Count saved beside the levels from your books.** Where a count is far from what was expected it says **Take a second look at: … (counted / expected).** Choose **Done**.

### Load stock from your books

Stock movements (while the app keeps stock; each movement once, by account, reference, item and kind) and stock levels (while stock comes from the books; each level replaces the last) load in bulk. Import them on **Imports**, under **Catalogue and stock** in **What to import**: **Stock movements** is offered while the app keeps stock and **Stock levels** while stock comes from the books ([Import and export](imports-and-exports.md)). **Open accounts** then leads to the accounts, whose **Stock** section shows them. An integrator's API client can send them too ([API clients and webhooks](../admin/api-clients-and-webhooks.md)).

### Read the stock reports

On **Reports**, **Stock on hand** gives each account's items and levels, and **Stock ledger** the month's movements ([Reports](reports.md)).

## What the system checks

- Fulfilment moves stock into the buying account, if its type keeps stock, and out of the supplying account for a secondary order. Each line moves only the units fulfilled since it last moved, so recording the same fulfilment again moves nothing (BR-62, `movementsFromFulfilment()`).
- A count adjusts stock at once to what was counted. It is flagged when it differs from what was expected by more than the tolerance, any difference when nothing was expected, or when the ledger had fallen below zero; a flag only draws a manager's eye (BR-62, `countResult()`).
- An order whose supplier is short is flagged, never refused (BR-62, `stockShortfall()`).
- While stock comes from the books, entries are refused and only loaded levels change it.
- Entries and counts are applied once, by their own IDs, however often they are sent.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This changed somewhere else. Refresh and try again. | Stock comes from the books here, so entries are refused; or the stock changed meanwhile. | Load levels instead, or reload. |
| This feature is switched off for your organisation. | Inventory is off. | Ask your admin to switch it on. |
| No stock here yet. | Nothing has been recorded, counted or loaded for this account. | Record an opening balance or a count, or load levels. |
