# Record sell-through

| | |
|---|---|
| **Who** | Field user, Manager (`sell_through.record`) |
| **Where** | Field app › an account's screen › **Record sell-through** (**Record liquidation** in the agri template) |
| **Module** | Core |
| **Related** | [Count stock](count-stock.md), [Visit an account](visit-an-account.md) |

Each month, an account that resells your products gives a stock statement per item: what it had, what came in, what went back and what is left. The app works out what sold through. In the agri template this is the liquidation statement of a distributor or retailer.

## Before you start

- Your admin has marked the account's type as giving a monthly statement (in the agri template, Distributor and Retailer).
- Recording works offline. The phone keeps this month's and last month's latest statements for the accounts you look after.
- This month is open while it runs, and last month stays open for the first five days of this one.

## Steps

1. On the account's screen, tap **Record sell-through** (under **On this visit** or **To do here**).
2. **Sell-through at …** opens on this month. In the first five days of a month, choose **This month** or **Last month** under **Month**.
3. **Opening stock comes forward from last month’s closing.** Each item shows its code and **Opening …**.
4. Use **Find an item** to narrow the list.
5. For each item, type **Received**, **Returned** and **Closing**. Where the app keeps the account's stock, an item not yet recorded this month starts from the ledger: **From the stock ledger: … in, … sent back. Change them if they differ.**
6. Each item shows **Sold through …** as the server will work it out, and any flag: **Sold below zero**, **Opening not last month’s closing** or **No price**.
7. Tap **Save**. The screen says **Saved. It uploads when there is a signal.** Saves still on the phone show as **… saves waiting to upload**.

You can save again later in the month; each save is a new version, merged over the last, and the latest counts.

## What the system checks

- Sold through is opening plus received, less returned, less closing (BR-53, `soldThrough()`).
- A negative figure and an opening that isn't last month's closing are flagged, never refused.
- Each line is valued at the account's price on the day the statement counts for; an item with no price is flagged.
- A month may change while it runs and for five days after; then it closes (BR-53, `statementOpen()`).
- A change made in those five days counts on the month's last day (BR-53, `creditedDate()`).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Change an item first.** | Nothing was changed | Type at least one figure |
| **Write each quantity as a number, such as 12 or 0.5.** | A figure isn't a number | Correct it |
| **There are no items yet.** | The phone has no catalogue items | Sync, or ask your admin |
| **That month is closed. Its figures can no longer change.** (in the upload queue) | The save reached the server after the month closed | Discard it; ask your manager if the figures matter |
