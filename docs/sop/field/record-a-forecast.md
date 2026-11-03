# Record a forecast

| | |
|---|---|
| **Who** | Field user, Manager (`forecast.record`) |
| **Where** | Field app › an account's screen › **Forecast by item** |
| **Module** | Core |
| **Related** | [Visit an account](visit-an-account.md), [Take an order](place-an-order.md) |

A forecast is what an account expects to order of each item in each of the next three months. You record it with the account; later, your organisation compares it with what was ordered.

## Before you start

- Recording works offline. The phone keeps the latest forecast of this month and the next three for the accounts you look after.
- A month locks on its first day. After that, only a manager can change it, on the portal, giving a reason.

## Steps

1. On the account's screen, tap **Forecast by item** (under **On this visit** or **To do here**).
2. **Forecast for …** opens on next month. Under **Month**, choose this month or one of the next three.
3. An open month says **Open until the month begins**; this month says **Locked** and **This month is locked. A manager can change it on the portal, giving a reason.** A locked month only shows what it holds.
4. Use **Find an item** to narrow the list. Items already in the forecast come first.
5. For each item, type the quantity expected in its base unit (**Quantity of …**). Type 0 to take an item out.
6. Tap **Save the forecast**. The screen says **Saved. It uploads when there is a signal.** Saves still on the phone show as **… saves waiting to upload.**

Each save is a new version, merged over the last: items you didn't touch keep their quantity. The latest version counts. A save made offline before a month locked still counts when it uploads after the 1st, as long as it uploads within the sync window (three days by default).

## What the system checks

- A forecast is for the three months after the current one; a month may change until it starts (BR-54, `forecastOpen()`).
- From a month's first day, only someone with `forecast.adjust` changes it, with a reason (BR-54). Managers hold it; field users don't.
- A quantity is zero or more; zero takes the item out.
- A save from the phone is judged on the day the phone saved it, not the day it uploads, if it uploads within the sync window and the phone's clock was right (within ten minutes of the server's, BR-44). Otherwise it is judged on the day it arrives (decision D136).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Type a quantity for at least one item.** | Nothing was typed | Type at least one quantity |
| **Write a quantity such as 12 or 0.5, 0 to take the item out.** | A quantity isn't a number | Correct it |
| **No items to forecast.** | The phone has no catalogue items | Sync, or ask your admin |
| **No forecast for this month yet.** | This month is locked and has no forecast | Nothing to do; ask your manager to add one on the portal |
| **That month is closed. Its figures can no longer change.** (in the upload queue) | The save was made after its month began, or uploaded later than the sync window, or the phone's clock was wrong, so it was judged as locked | Discard it, and ask your manager to change the month on the portal |
