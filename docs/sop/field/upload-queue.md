# Use the upload queue

| | |
|---|---|
| **Who** | Everyone using the field app |
| **Where** | Field app › **Home** › the sync banner; Field app › **More** › **Upload queue** |
| **Module** | Core |
| **Related** | [Take an order](place-an-order.md), [Install the app and sign in](install-and-sign-in.md) |

Almost everything you record on the phone (the day's start and end, check-ins, forms, photos, orders, collections, claims, requests) is saved on the phone first and waits in the upload queue until it reaches the server. Normally you never open it. You do when the banner on Home turns red: the server refused something and it needs you.

## Before you start

- While the app is open, it syncs at once after signing in, whenever it comes back to the screen, when the network returns, and every minute. Items upload oldest first, and an item that depends on another (a form on its photos, an order on its visit's check-in) waits for it.
- An item that fails for a passing reason (no signal, the server busy, a photo still uploading) waits and tries again by itself. An item the server refuses for good is parked as refused.

## Steps

### Read the banner on Home

- No banner: everything has uploaded.
- Amber, **… items are waiting to upload.**, or **Offline. … items are saved on this phone.** without signal: nothing to do; they upload by themselves.
- Red, **… items were refused. Open the upload queue to see why.**: tap **View**.

**More** shows the same under **Upload queue**: up to three items, each **Waiting** or **Needs you**, **See all … waiting** for the rest, and **Send now** to try at once. With nothing waiting, it says **Everything has uploaded**. The foot of **More** shows the app version and when it last synced (**Synced …**).

### Open the queue

1. Tap **View** on the banner, or an item under **Upload queue** on **More**.
2. **Upload queue** says **What you save on this phone waits here until it reaches the server.** and when it last synced (**Last synced …**, or **Not synced yet**).
3. Tap **Sync now** to try at once. Without signal it says **No signal. Everything uploads by itself when it returns.**
4. Each item shows what it is (such as **Check-in**, **Form**, **Order**, **Collection**, **Expense claim**, **Photo**), **Saved …**, and **Waiting** or **Refused**. A waiting item may say **Next try …** and why it is waiting.

### Deal with a refused item

1. Read why under the item. It is the server's reason, such as **This was recorded too long ago to be counted.**
2. If the cause is fixed (for example, your manager reset your device, or your organisation is no longer read only), tap **Try again**.
3. For an order refused because prices changed, tap **Price it again** instead ([Take an order](place-an-order.md)).
4. If the item can never upload, tap **Discard**. It asks **Discard this record? It is deleted from this phone and will never upload.** Tap **Discard it**, or **Keep it**.
5. Items that needed a discarded one park with **Something this record needed was discarded, so it can't upload. Discard it too.**

Discarding is final: the record is gone from the phone and never reaches the server. Before discarding something that matters, such as a collection or an order, tell your manager what it was.

### Signing out with items waiting

Signing out keeps the queue on the phone for your next sign-in on it ([Install the app and sign in](install-and-sign-in.md)). Someone else signing in on the phone doesn't send your items.

## What the system checks

- Each item carries its own ID, so an item sent twice is applied once.
- A record captured more than your organisation's sync window ago (72 hours by default) is refused.
- A record captured outside your shift is refused where it needs one.
- The server judges every capture again: the fix, the geofence, the shift and the prices (BR-14, BR-32, BR-33, BR-36).
- Not enough signal, a server error, too many requests, or a photo still uploading are passing reasons: the item backs off and tries again. Any other refusal parks it.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **This was recorded too long ago to be counted.** | Past the sync window | Discard it; tell your manager |
| **This was recorded outside your duty hours, so it cannot be saved.** | No shift at the time it was captured | Discard it; tell your manager if it mattered |
| **You are too far from this account.** | A required geofence refused it | Discard it |
| **Prices have changed. Check your cart, then send the order again.** | Prices changed before the order uploaded | **Price it again** |
| **This phone is not registered for your account. Ask your manager to reset your device.** | The phone isn't bound to you | Ask your manager, then **Try again** |
| **A photo is still uploading. This will retry by itself.** | The photo hasn't reached storage yet | Wait |
| **This version of the app can't upload this record. Update the app.** | An older build | Install the newer build, then **Try again** |
| **Your organisation is being moved to a new server. You can look around; changes can be made again shortly.** | A planned move | Wait; items try again |
| **The server could not be reached. Check your connection, then try again.** | No connection | Wait for signal |
