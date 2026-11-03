# Clear the upload queue and fix sync problems

| | |
|---|---|
| **Who** | The person whose phone it is; their manager or the tenant's admin (`user.view`, `user.reset_device`); vendor support |
| **Where** | Field app › **Home** (the banner) and **More** › **Upload queue**; web portal › **People** › the person › **Phone** |
| **Module** | Core |
| **Related** | [Use the upload queue](../field/upload-queue.md), [Sign-in and sessions](sign-in-and-sessions.md), [GPS and geofences](gps-and-geofences.md), [Photos](photos.md), [Access and modules](access-and-modules.md) |

Everything a person records on the phone is saved there first and waits in the upload queue until the server takes it. Most of the time it leaves by itself. This procedure explains the banner, why an item waits or is refused, and what to do about each refusal.

## Before you start

- On the phone, open **More**. Under **Upload queue** it lists the first few items with **Waiting** or **Refused**, as the queue does; tap one, or **See all … waiting**, to open the **Upload queue** screen. With nothing left it says **Everything has uploaded**.
- In the portal, a manager can see what the phone last reported: **People** › the person › **Phone** shows **Last sync** and **Waiting to upload** ("… waiting, … refused").

## What you see, and what to do

### The banner on Home

| What you see | What it means | What to do |
|---|---|---|
| Amber: **… items are waiting to upload.** | Items are queued and the phone has a connection; they go one at a time, oldest first | Nothing. Tap **View** to watch them leave, or **Sync now** on the queue to try at once. |
| Amber: **Offline. … items are saved on this phone.** | No connection | Nothing is lost. They upload when the signal returns. |
| Red: **… items were refused. Open the upload queue to see why.** | The server refused at least one item, and it won't try again by itself | Tap **View** and deal with each **Refused** item, as below. |
| No banner | Everything has uploaded | |

### An item stays "Waiting"

On the **Upload queue** screen each item shows **Saved** with its time, and a waiting item may show **Next try** with a time and the last problem in grey.

| Why | What to do |
|---|---|
| No connection: **The server could not be reached. Check your connection, then try again.** | Wait for signal, or tap **Sync now** once there is some. |
| A failure the server may get over: a server error, **Too many attempts. Wait a moment, then try again.**, or **A photo is still uploading. This will retry by itself.** | Nothing. The phone tries again after 5 seconds, then doubles the wait up to 15 minutes. |
| The organisation is read only or suspended (**Your organisation's subscription is read-only for now. Ask an admin about billing.**), or being moved to a new server (**Your organisation is being moved to a new server. You can look around; changes can be made again shortly.**) | Items wait and go once the organisation is open again. **Home** and the **Upload queue** say so above everything else while it lasts (decision D140). See [Access and modules](access-and-modules.md). |
| It needs another item to go first: it says **Waits for … to upload first.**, or **Waits for …, which was refused. Try that again or discard it.** | The rest of a day waits for its **Start day** (the item's name is the tenant's word, such as **Punch in**); an order waits for its visit's **Check-in** and the day's **Start day**; a collection waits for its visit's **Check-in**; a record with photos waits for its **Photo** items. If the item it needs was refused, fix or discard that one first. |
| The app is signed out, or needs an update | Nothing uploads until the person signs in again or updates the app ([Sign-in and sessions](sign-in-and-sessions.md)). |

Items go in the order they were saved. One item that keeps failing for a passing reason holds back the ones after it until it goes.

### An item is "Refused"

A refused item shows **Refused** and the reason in red, with **Try again** and **Discard**. It never leaves by itself. Work out from the reason whether trying again can help:

- **Try again** puts it back in the queue. Use it when what was wrong has since changed: the person was given access, the module is on again, an admin reset something.
- **Discard** asks **Discard this record? It is deleted from this phone and will never upload.** Tap **Discard it** to delete it, or **Keep it**. Anything that needed it is then refused with **Something this record needed was discarded, so it can't upload. Discard it too.**
- Before discarding, note what the record was, so the person can record it again if it still matters.

| Reason shown | What it means | What to do |
|---|---|---|
| **Prices have changed. Check your cart, then send the order again.** | The order was priced on the phone with prices or schemes the server no longer has (BR-14) | Tap **Price it again**. The phone syncs, prices the cart as things are now and sends the order again under the same ID. If it says **Nothing on this order can be ordered here now. Discard it and take a new one.**, discard it and take a new order. |
| **This request was already sent with different details. Start it again.** | The server already has this record, as it was first sent; the copy on the phone differs (BR-46) | Check the record in the portal. If the server's copy is right, discard the phone's. If not, discard it and record it again as a new record. |
| **You are not on duty. Tap Start day first.** | The record was made with no open day. An order is judged at the moment the phone took it, so this means it was taken off duty, or on a phone whose clock was more than ten minutes out (decision D136) | Discard it. Next time, start the day first. A form that allows capture off duty doesn't need one. |
| **This was recorded outside your duty hours, so it cannot be saved.** | It was recorded before **Start day** or after **End day** | Discard it. |
| **Your day passed the longest allowed shift and was closed.** | It was recorded past **Longest shift** (14 hours by default) | Discard it. The admin sets **Longest shift** under **Settings** › **Rules**. |
| **Your day has already started.** | A second **Start day** for a day already open | Discard it; the open day carries on. |
| **This was recorded too long ago to be counted.** | It waited on the phone longer than **Oldest record a phone may send** (72 hours by default) | It can't be counted. Discard it. Phones should get signal at least every few days. |
| **Your location looks simulated. …**, **Your location is out of date. …**, **Your location is not accurate enough. …** | The record's location failed the evidence checks (BR-32) | It can't be fixed from the queue. Discard it and record it again with a fresh location. See [GPS and geofences](gps-and-geofences.md). |
| **You are too far from this account.** | A check-in or form outside a geofence that must not be left (BR-33) | Discard it and record it again at the place. See [GPS and geofences](gps-and-geofences.md). |
| **Add a photo to continue.** | The record needs a photo it doesn't have | Discard it and record it again with the photo. |
| **The server refused some of its details.**, with a line for each, such as **• This item can no longer be ordered** | The server found something wrong with what was sent; each line is the server's own words for one detail, in English | Read the lines. Note the record, discard it and record it again with that put right; if it keeps happening, report it to vendor support with the time and the lines. |
| **You don't have access to this.**, **This is outside the people and places you look after.** or **This feature is switched off for your organisation.** | The person's role, scope or modules changed since they recorded it | Have an admin check the role and modules ([Access and modules](access-and-modules.md)), then **Try again**, or discard it. |
| **This changed somewhere else. Refresh and try again.** | Something it refers to changed on the server | **Sync now**, then **Try again**. If it is refused again, discard it. |
| **That month is closed. Its figures can no longer change.** | A sell-through statement or forecast for a month that has closed (BR-53, BR-54); a forecast saved on the phone counts on the day it was saved, if it uploads within the sync window (decision D136) | Discard it. A manager or back office corrects the month in the portal, where the rules allow. |
| **This is over your limit.** | A leave request or claim over the balance or cap | Discard it and ask for less, or ask the manager. |
| **This version of the app can't upload this record. Update the app.** | The app no longer knows this kind of record | Update the app, then **Try again**. |

### The phone's copies look wrong or out of date

The phone keeps copies of accounts, plans, prices, forms and settings, and asks for what changed at every sync.

1. Tap **Sync now** on the **Upload queue** screen and check **Last synced**.
2. If the copies are still wrong, sign out and sign in again, with signal. Signing out clears the phone's copies (not what waits to upload), and the next sign-in fetches everything again. On duty, the app warns first that signing out stops recording the route.
3. Some refreshes happen by themselves. **Your phone needs a full refresh. It is starting now.** means the server asked the phone to fetch everything again: after the vendor raised `SYNC_EPOCH` for the whole cell, or after the organisation moved to another server. The phone does it on its own.

### "Your organisation has moved to a new server. Try again."

The organisation was moved between servers (decision D95). The app and the portal find the new server by themselves and repeat the request; the message shows only if that didn't work at once. Try again. The phone's copies are fetched again in full after a move.

### Signing out with items not uploaded

**More** › **Sign out** warns "… records haven't uploaded. They stay on this phone and upload when you sign in again." Tap **Stay signed in** to go back, or **Sign out anyway**.

- The items stay on this phone and upload only when the same person signs in on it again. Someone else signing in on the phone doesn't send them.
- A reset of the person's phone doesn't move them. Before **Reset phone**, ask the person to upload from the old phone ([Sign-in and sessions](sign-in-and-sessions.md)).

## What the system checks

- Each record carries the ID the phone gave it, so a record sent twice is applied once; the same ID with different details is refused (BR-46).
- An item that fails for a passing reason waits `min(15 minutes, 5 seconds × 2^tries)` and keeps its place; any other refusal parks it until someone acts (spec 11.3).
- Records are judged as the server finds things when they arrive: the person's access, the day open on the phone, the location's checks, and **Oldest record a phone may send** (BR-32, BR-36).

## Waiting on the owner

- The device protocol (spec 14.5) has yet to be run on two Android phones of different brands; it may find upload or sync problems this procedure doesn't cover.
- The server's own words about a refused record are English and aren't shown in the queue, which shows the general sentence for its code in the person's language (D42 open item).
