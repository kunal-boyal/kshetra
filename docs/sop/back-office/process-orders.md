# Process orders

| | |
|---|---|
| **Who** | Back office (`order.view`, `order.create`, `order.fulfil`); approvers decide: Manager, Business head, Admin (`order.decide`), lines by Business head and Admin (`order.line_decide`) |
| **Where** | Web portal › **Orders** (the tenant's word for orders); **Orders** › **New order** for the order desk |
| **Module** | Orders; Inventory for stock moving on fulfilment |
| **Related** | [Decide approvals](../manager/approvals.md), [Keep distributors' stock](stock.md), [Keep receivables and statements](receivables-and-statements.md), [Schemes](../admin/schemes.md), [Reports](reports.md) |

Orders come from field people's phones and from the order desk. Each goes through its approval chain; once accepted, the back office records what went out (fulfilment) or cancels it. Orders are requests from the field: accepting one doesn't create an invoice, reduce your own stock or count as sales, unless a metric counts accepted orders.

## Before you start

- Prices come from the price lists that apply to the account on the day; an admin keeps them in Settings › **Price lists**. Schemes come from Settings › **Schemes**.
- Your organisation's reasons for rejecting orders and lines are in its catalogue settings; without any, the reasons are **Overdue**, **Credit limit exceeded** and **No stock**.

## Steps

### Read the register

1. Open **Orders** in the left rail. Choose the month with **Previous month** and **Next month**.
2. Under **Status**, choose a chip: **Waiting**, **Accepted**, **Partly accepted**, **Rejected**, **Fulfilled**, **Partly fulfilled** or **Cancelled**.
3. For a range of dates, choose **More filters** and give **From** and **To**: dates, when given, replace the month.
4. The table lists each order's number, **Date**, account (the tenant's word, such as distributor or retailer in the agri template), **Taken by**, **Value** and **Status**. Choose a row to see it beside the table, then **Open** for its page.

### Read an order

The order's page shows:

- **Placed by …, …**; an order sent from a phone without signal is marked **taken offline, sent later** in **What happened**.
- **Supplied by**: **Your company** for a primary order, or the account that supplies it for a secondary one.
- Each line: **Item**, **Quantity** (with base units), **Net rate**, **Taxable**, **Tax**, **Total**, **Decision** and **… fulfilled**. A line under a scheme shows **Scheme: …** or **…: … off**; free goods show under **Free goods**, at price 0. **Supplier short by … … when placed** marks an item its supplier lacked when it was placed.
- **Totals**: **Taxable**, **CGST**, **SGST** and **Total**.
- **What happened** and **Approval steps**.

Choose **Print** to print it.

### Decide an order

Approvers reach an order from **Approvals** through **Open to decide**; it is never decided in the inbox.

1. On the order's page, under **Your decision**, choose **Accept**, or choose a **Reason** (**Choose a reason**), add **Anything to add** if you wish, and choose **Reject**.
2. Where the step decides line by line (`order.line_decide`), **Decide each line** shows instead: for each line, **Decision on …**: **Accepted** or **Rejected** with a **Reason**. Choose **Save the decisions**. If every line is rejected, so is the order.
3. Free goods follow the line they came with.

### Record fulfilment

Back office (`order.fulfil`), on an accepted or partly accepted order.

1. Under **Fulfilment**, give for each accepted line how much has gone out so far, in base units (**…: of … …**).
2. Choose **Save fulfilment**. The order becomes **Partly fulfilled** or, once every accepted line has gone out in full, **Fulfilled**.
3. Record more later the same way: the figure is the running total, never the latest delivery alone.

With Inventory on and stock kept by the app, fulfilment moves stock into the buying account and, for a secondary order, out of its supplier ([Keep distributors' stock](stock.md)).

### Cancel an order

1. On an accepted or partly accepted order with nothing fulfilled yet, choose **Cancel the order**.
2. It asks **Cancel this order?**; write **Why is it cancelled?**, then choose **Cancel the order**, or **Keep it**.

### Take an order at the desk

For an order taken by phone call or at the counter (`order.create`).

1. On **Orders**, choose **New order**.
2. Under **Which account**, narrow by **Account type** and **Find by name or code**, then choose the account. **For …** names it; **Choose another** goes back.
3. Under **Add**, choose the **Item** (**Choose an item**), the **Unit** and the **Quantity**, then choose **Add**. Each line is priced as the server will price it, from the lists that apply today, with its scheme and any free goods (**… … of … free**). **Remove** takes a line out.
4. Where the supplier holds less than the order asks for, the page says so: **… holds less than this asks for: …. It can still be placed.**
5. Add a **Note** if needed, then choose **Place the order**. It goes through its approval chain like any other.

## What the system checks

- Every line is priced on the day the order was placed from the lists that apply to the account (`applicableLists()`, `priceFor()`, `priceLine()`, BR-10 to BR-12). If what the screen showed differs from what the server works out, the order is refused so nobody is charged a price they didn't see (BR-14, `quoteDifferences()`).
- An order too large to place is refused (BR-13, `orderSizeIssue()`).
- Each line takes one scheme, the best for the customer, with slabs counted across the order; the discount comes off the taxable value before tax (BR-55, `chooseSchemes()`).
- GST is shown as equal CGST and SGST halves that always add up to the tax (`gstHalves()`).
- Status follows the lines' decisions and fulfilment (BR-19, `statusFromLines()`, `statusAfterFulfilment()`). Fulfilment is only for accepted lines, never more than was ordered and never less than already fulfilled.
- A short supplier is flagged, never a reason to refuse an order (BR-62).
- A line's item is kept as it was when ordered, even if the catalogue changes later (BR-15).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Prices changed since they were shown. Check the lines and place it again. | A price or scheme changed after the desk priced the lines. | Check the lines, then place it again. |
| This order is too large to place. | The order breaks the size limit. | Split it into smaller orders. |
| This item is on the order already in another unit. Change that line instead. | One item, two units. | Change the existing line's quantity. |
| No price list prices anything for this account yet, so there is nothing to add. Prices are kept at Settings › Price lists. | No price list covers this account. | Ask your admin to price it in Settings › **Price lists**. |
| Some details need fixing. Check the highlighted fields. | A rejection without a reason, or fulfilment more than ordered or less than already fulfilled. | Fix the highlighted field. |
| This changed somewhere else. Refresh and try again. | The order was decided, fulfilled or cancelled meanwhile, or it can't be fulfilled in its status. | Reload the order. |
| It isn't your turn to act on this, or someone else already has. Refresh your inbox. | The order isn't at your step. | Reload; check **Approval steps**. |

## Waiting on the owner

- Phase 2's exit check: three real invoices with their orders, to show order totals match to the paisa.
- 3 or 4 real schemes or promotions, to test the scheme engine against.
- The ERP connectors that send accepted orders to Zoho Books, SAP Business One or Tally haven't had a pass against a real system.
