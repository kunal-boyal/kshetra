# Take an order

| | |
|---|---|
| **Who** | Field user, Manager (`order.create`) |
| **Where** | Field app › an account's screen › **New order** (the tenant's word for order: POB in pharma); Field app › **Orders** |
| **Module** | Orders |
| **Related** | [Visit an account](visit-an-account.md), [Use the upload queue](upload-queue.md), [Count stock](count-stock.md) |

You take an order at an account in two steps: choose the items and quantities, then review the priced order and place it. The phone prices it from the price lists and schemes it keeps, as the server will.

## Before you start

- The Orders module is on, and a price list on the phone covers the account. An account that no price list on the phone covers shows no **New order**.
- The account is active and one you look after.
- Location is on: every order records where it was taken.
- Your admin decides whether orders may be taken offline (the default) or need a connection, and whether they need you on duty (off by default). Where they need you on duty, start your day first.

## Steps

### Choose the items

1. On the account's screen (in a visit, or without one), tap **New order**. From the **Orders** tab, **New order** opens your accounts first.
2. Find items with **Search items or codes**, or choose under **Categories** (**All** for every one).
3. Each item shows its rate (**… a …, after discount**). Where the supplier's stock is known, it says **Supplier has … …**.
4. Use the minus and plus beside an item to change its quantity in its base unit.
5. To order in another unit, such as a case, tap the item. Choose the **Unit** (each says what it holds, **… … each**), type the **Quantity**, and tap **Add**. **Cancel** closes it.
6. The bar at the foot counts the items, says **+ GST**, and has **Review**. Tap **Review**.

### Review and place

1. **Review the order** lists each line: the quantity, unit, rate and GST, and, in another unit, what it comes to in the base unit.
2. Under a line:
   - a scheme that applies, such as **…: … off** or **Scheme: …**;
   - free goods, such as **… … of … free**;
   - **Supplier short by … …** when the supplier holds less.
3. The totals show **Subtotal**, **CGST**, **SGST** and **Total**.
4. Read the notices:
   - **Within credit: … of the … limit was free before this order.**, or **This takes the account past its credit limit, so it may need another approval.**
   - **… holds less than … lines ask for. They can still be placed.** when the supplier is short.
   - **Turn on location: every order records where it was taken.** when there is no fix.
   - **Tap Start day before taking this order.** where orders need you on duty and your day hasn't started. **Place the order** stays off until you start it.
5. Add a **Note** if you need to.
6. Tap **Place the order ·** the total. **Back to the items** goes back to change it.
7. Where orders may be taken offline, the screen says **No signal? The order waits on this phone and sends itself. If a price changes first, you are asked to price it again.** The order saves on the phone and uploads. Where they need a connection, it says **Orders need a connection here; this sends straight away.**, and the order goes to the server at once.

The account's screen lists it under **Orders here**: **Waiting to send** until it uploads, then with its status and value.

### When an order is refused because prices changed

If a price list or scheme changed before the order uploaded, the server refuses it and it parks in the upload queue with **Prices have changed. Check your cart, then send the order again.**

1. Open the upload queue (the red banner on **Home**, or **More** › **Upload queue**).
2. On the order, tap **Price it again**. The phone syncs, prices the same lines with today's prices and schemes, and sends the order again under the same ID.
3. If nothing on it can be ordered at that account now, it says **Nothing on this order can be ordered here now. Discard it and take a new one.** Tap **Discard**, then **Discard it**, and take a new order.

### Your orders

1. Open the **Orders** tab.
2. Orders still on the phone are under **Waiting to send**; the ones the phone keeps are under **Taken by you**, newest first, each with its account, value, number of lines and status: **Waiting**, **Accepted**, **Partly accepted**, **Rejected**, **Fulfilled**, **Partly fulfilled** or **Cancelled**.
3. **New order** opens your accounts to take another.

## What the system checks

- Each line is priced from the price list that applies to the account on the day the order is placed, with its discount and tax, rounded as the catalogue says (BR-10 to BR-12, `priceLine()`).
- An item appears on one line; an order has at most 200 lines and a ceiling on its total (BR-13).
- Each line gets at most one scheme, the one best for the customer; slabs count across the order; free goods come as their own lines at no charge; a scheme's discount comes off before tax (BR-55).
- The server prices the order again; if any line's price or scheme differs from what the phone showed, it refuses with a price change (BR-14, `quoteDifferences()`).
- An order past the account's credit limit is placed, and its approval may take another step. An order is never refused for the supplier's stock (BR-62).
- An order taken in a visit uploads after the visit's check-in, and one taken on duty after your **Start day**.
- Where orders need you on duty, the server judges the shift at the moment the phone took the order, not when it uploads: an order taken offline on duty still counts after you end the day, and one taken off duty never does (decision D136).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| No **New order** on the account | No price list on the phone covers the account | Sync, or ask your admin about price lists |
| **No prices for this account** / **No price list on this phone covers it yet. Prices arrive with the next sync.** | The order screen was opened for an account no price list covers | Sync, or ask your admin about price lists |
| **No item matches. Try another name or code.** | The search found nothing | Change the search or category |
| **This order is too large to place.** | The total is over the ceiling | Split it into smaller orders |
| **Turn on location: every order records where it was taken.** | No fix | Turn on location and wait for a fix |
| **Prices have changed. Check your cart, then send the order again.** | Prices or schemes changed | **Price it again** in the upload queue |
| **Tap Start day before taking this order.** | Your organisation needs you on duty to take orders | Start your day, then place it |
| **You are not on duty. Tap Start day first.** (in the upload queue) | The order was taken off duty, or on a phone whose clock was wrong | Discard it and take it again on duty |
| **The server could not be reached. Check your connection, then try again.** | Orders need a connection here and there is none | Move to signal and place it again |
| **This is no longer on your phone. It may have moved to someone else.** | The account left your reach | Ask your manager |
