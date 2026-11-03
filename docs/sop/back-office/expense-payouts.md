# Pay expense claims

| | |
|---|---|
| **Who** | Back office, Business head, Admin (`expense.mark_paid`); approvers (`approval.act`) also see the page |
| **Where** | Web portal › **Expenses** |
| **Module** | Expenses |
| **Related** | [Decide approvals](../manager/approvals.md), [Payroll](payroll.md), [Reports](reports.md) |

Field people claim expenses on their phone under the organisation's expense policies; approvers decide them in **Approvals**. Once a claim is approved, the back office pays it outside the product and marks it paid here. The **Expenses** page shows the month's claims, what the policies and caps made of them, and what to look at before paying.

## Before you start

- Expense policies are kept by an admin in Settings › **Expense policies**; **Policies** on this page opens them for those who may.
- Claims reach **Approved, to be paid** only through their approval chain. The back office doesn't approve them.

## Steps

### Read the month's claims

1. Open **Expenses** in the left rail. The heading is **Expenses · …**; choose the month with **Previous month** and **Next month**.
2. The tiles sum the month: **Claimed**, **Waiting for a decision**, **Over the policy** (cut by the caps, never paid) and **Approved for payment**, each with its number of claims.
3. Under **Status**, choose **Waiting**, **Approved**, **Rejected**, **Cancelled** or **Paid** to narrow the list.
4. Each claim shows its **Day**, **Person**, **Policy** (with its rate and caps, such as **up to … a day** or **bill needed**), **Bills** (how many receipts), **Amount**, **Over policy**, **Where it is** (**…, step … of …**, **Approved, to be paid**, **Paid on …**, **Rejected by …** or **Withdrawn**) and **Status**.
5. Look at a claim's flags before paying it. The page counts its receipts but doesn't show the photos: **Receipt seen before** (the same receipt photo on another claim), **No receipt yet**, **Readings changed from the shift** and **Tracked and odometer km differ**. A per-km claim also shows **… km on the odometer** and **… km tracked**.

### Mark a claim paid

1. Pay the claim through your bank or payroll as usual.
2. On its row, choose **Mark paid**. It asks **Mark … to … paid?**
3. Give the **Payment reference** if you have one, such as a bank transfer number; it is optional.
4. Choose **Mark paid**, or **Not yet**. The claim becomes **Paid**, with **Paid on …**.

### Export for payroll

1. Choose **Export for payroll**. The month's **Expense register** is prepared as a file.
2. Download it from **Reports** › **Your downloads** ([Import and export](imports-and-exports.md)).

## What the system checks

- What a claim comes to (BR-29, `claimBase()`): per km pays the odometer distance, or the day's tracked distance where the policy takes it from there; per day and per visit pay their rate; actual pays the bill.
- Caps apply in order: per claim, then what is left of the day's and the month's caps after the person's other claims under the policy (BR-29, `capClaim()`). What the caps cut is shown as over the policy and never paid.
- A claim under a policy that needs receipts can't be approved without one (BR-30, `receiptHoldsApproval()`).
- A receipt photo seen before is flagged, never blocked (BR-40).
- Tracked and odometer kilometres are flagged when they differ by more than 10% of the larger and at least 2 km (`distanceGap()`, decision D115).
- Only an approved claim can be marked paid, once. Marking paid is recorded in the audit log.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This changed somewhere else. Refresh and try again. | The claim isn't approved, or is already paid. | Reload; pay only claims **Approved, to be paid**. |
| This is outside the people and places you look after. | The person is outside your scope. | Ask someone whose scope covers them. |
| No claims | Nobody claimed in this month or status. | Change the month or status. |
| This feature is switched off for your organisation. | Expenses is switched off. | Ask your admin. |
