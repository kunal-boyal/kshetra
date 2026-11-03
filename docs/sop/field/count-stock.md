# Count stock

| | |
|---|---|
| **Who** | Field user, Manager (`stock.view`, `stock.count`) |
| **Where** | Field app › an account's screen › **Count stock** |
| **Module** | Inventory (off until an admin switches it on) |
| **Related** | [Take an order](place-an-order.md), [Record sell-through](record-sell-through.md), [Visit an account](visit-an-account.md) |

At an account that holds stock, such as a distributor, you count what is on its shelves and record it. The count sets the account's stock, and a big gap from what the ledger expected is flagged for your manager.

## Before you start

- An admin has switched the Inventory module on.
- The account's type keeps stock (in the templates: Distributor in agri and FMCG, Stockist in pharma, Dealer in building materials).
- Counting works offline. The phone keeps each account's stock, so the account screen and a cart through that supplier show it without signal.

## Steps

1. Open the account's screen. Under **Stock**, it lists each item it holds with the quantity in its base unit (**No stock here yet.** when it holds none). A quantity below zero shows in red.
2. Tap **Count stock** (under **On this visit** or **To do here**).
3. **Count stock at …** says **Write what is there. Items left empty aren’t counted.** The items the account holds come first, each with **… … now**.
4. Use **Find an item** to narrow the list.
5. Under each item you counted, type the quantity (**Counted of …**). Leave the rest empty.
6. Tap **Save the count**.
7. The screen says **Count saved. It uploads when you’re online.** The account's stock on the phone changes at once.

## What the system checks

- At least one item must have a count, and each count is a number of zero or more with up to three decimals.
- A count sets the account's stock to what you counted. The difference from what the ledger expected is recorded as an adjustment, and flagged when it is more than your organisation's tolerance, or when the ledger had fallen below zero (BR-62, `countResult()`). Flags only draw a manager's eye.
- A count is applied once, by its own ID, however many times it uploads.
- Where your organisation's stock comes from its books instead of the app, a count is kept as seen beside the books' levels and moves nothing.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Write a count for at least one item.** | Nothing was typed | Type at least one count |
| **Write counts as numbers of up to three decimals, zero or more.** | A count isn't a number | Correct it |
| **No items to count.** | The phone has no catalogue items | Sync, or ask your admin |
| No **Count stock** on the account | The module is off, the account's type doesn't keep stock, or your role can't count | Ask your admin |
| **This is no longer on your phone. It may have moved to someone else.** | The account left your reach | Ask your manager |
