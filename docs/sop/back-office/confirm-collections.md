# Confirm collections

| | |
|---|---|
| **Who** | Back office, Admin (`collection.confirm`); others with `collection.view` read them |
| **Where** | Web portal › **Collections**; a collection's page; **Accounts** › an account › **Finance** |
| **Module** | Account finance |
| **Related** | [Keep receivables and statements](receivables-and-statements.md), [Import and export](imports-and-exports.md), [Reports](reports.md) |

Field people record the money they collect from accounts: cash, UPI, cheque or bank transfer. The office confirms each one it has received, rejects one it hasn't, and marks a bounced cheque. A collection is never a receipt in the books: it stands beside them until the books' receipt for it arrives and is matched to it.

## Before you start

- A collection is matched to the books when receipts arrive, through the bulk API or an ERP connection ([Keep receivables and statements](receivables-and-statements.md)).
- The cash limit is on Settings › **Rules** (**Cash from one account in a day must stay under (₹)**), by default ₹2,00,000.

## Steps

### Work through what waits

1. Open **Collections** in the left rail. It opens on **Waiting for the office** for those who confirm. Choose the month with **Previous month** and **Next month**.
2. The tiles sum the month: **Waiting for the office**, **Not yet in the books** (waiting or confirmed, with no receipt in the books yet), **In the books** and **Turned down** (rejected and bounced).
3. Under **Status**, choose **Waiting for the office**, **Confirmed**, **Rejected**, **Bounced** or **In the books**.
4. The table lists each **Collection**, **Date**, account (the tenant's word), **Collected by**, **Paid by**, **Amount** and **Status**. Choose a row: it opens beside the table with **Taken**, **Collected by**, **Where** (**At the account**, **Away from the account**, or not known), the cheque's details and photo (**Date on the cheque**), and **Note**.
5. Check it against what reached you: the cash, the UPI or bank credit, or the cheque.
6. Under **What the office does**:
   - choose **Confirm** when you have it;
   - choose **Reject**, write **Why**, and confirm **Reject this collection?** when you don't.

### Decide several at once

1. Under **Decide several at once**, choose **Select all … waiting**, or tick **Select** on each.
2. Choose **Confirm … selected**, or **Reject … selected**: write **Why** and confirm **Reject … collections?**
3. The page says **… decided.**, and **… could not be: they were decided already or are your own.** for any it couldn’t decide.

### Mark a cheque bounced

1. Open the confirmed cheque collection.
2. Choose **Cheque bounced**, write **Why**, and confirm **Mark this cheque bounced?** with **Mark bounced**.

A cheque already matched to a receipt must have its match undone first (below).

### Match to the books by hand

Collections match themselves when the books' receipts arrive. Match by hand only when the automatic match can't tell: a different amount or date.

1. Open the confirmed collection and choose **Match to a receipt**.
2. Under **The receipt in the books**, choose the receipt (**Choose a receipt**), then **Match**. The collection shows **Receipt … of …, matched by hand** and becomes **In the books**.
3. To undo a match, choose **Undo the match** and confirm **Undo this match?**. The collection waits for its receipt again, and counts as not yet in the books.

### Print a receipt

1. Choose **Open the collection** to go to its page.
2. Choose **Print the receipt**. The receipt reads **Payment received**, with the amount, account, date and how it was paid, and **Collected by …**. Until the office confirms it, it says **Awaiting the office’s confirmation.** A rejected or bounced collection has no receipt.

### See an account's collections

On the account's page, **Finance** shows **Collected, not yet in the books**, **Left after it** (what is owed once those reach the books) and **Latest collections**.

## What the system checks

- When recorded on the phone (BR-63, `collectionIssues()`): a cheque names its number, bank and date and comes with its photo; UPI and bank transfers name their reference; cash from one account in a day, this one included, stays under the cash limit (section 269ST of the Income-tax Act).
- Moves (BR-63, `collectionMoveIssue()`): waiting goes to confirmed or rejected; confirmed goes to bounced or in the books; in the books goes back to confirmed only by undoing the match. Nobody confirms, rejects or bounces their own collection. A rejection or bounce gives its reason. Only a cheque bounces.
- Automatic matching (BR-63, `matchReceipts()`): each receipt, oldest first, takes the oldest confirmed collection still unmatched at the same account for the same amount, dated on the receipt's day or up to 30 days before. One receipt matches one collection.
- What an account owes counts collections not yet in the books as paid, never below zero (`collectedNotInBooks()`), for the credit check on orders too.
- Every change is recorded in the audit log; rejected and bounced collections notify the collector.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This changed somewhere else. Refresh and try again. | It was decided meanwhile, or the move isn't allowed from its status, such as bouncing a cheque already in the books. | Reload; undo a match before bouncing. |
| You don't have access to this. | It is your own collection, or your role can't confirm. | Leave it to a colleague. |
| Some details need fixing. Check the highlighted fields. | A rejection or bounce without a reason. | Write **Why**. |
| No collections here | Nothing matches the month and status chosen. | Change the month or status. |
| This feature is switched off for your organisation. | Account finance is switched off. | Ask your admin. |
