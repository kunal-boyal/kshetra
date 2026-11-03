# Visit an account

| | |
|---|---|
| **Who** | Field user, Manager (`visit.use`, `account.view`; proposing a location needs `account.propose_location`) |
| **Where** | Field app › **More** › **Accounts** (the tenant's word for accounts), or **Home** › **Unplanned visit**, or a stop on **Plan** |
| **Module** | Core |
| **Related** | [Follow today's plan](todays-plan.md), [Fill a form](fill-a-form.md), [Take an order](place-an-order.md), [Collect a payment](collect-a-payment.md) |

A visit is the time between checking in at an account (a retailer or distributor in the agri template, a doctor or chemist in pharma) and checking out. While you are checked in, the account's screen lists the visit's work: its forms, an order, a collection and the rest.

## Before you start

- You have started your day ([Start your day](start-your-day.md)). Checking in needs you on duty.
- The account is active and one you look after. The phone keeps your accounts, so the list, search and check-in all work offline.
- Your admin sets each account type's geofence: off, advisory or required, with a radius (300 m by default).

## Steps

### Find the account

1. Open **More** › **Accounts**, or tap **Unplanned visit** on **Home**, or tap a stop on **Plan**.
2. Under **Search**, type part of a name or code.
3. Where you look after more than one type, choose one under **Type**, or **Any**.
4. With location on, the nearest come first, each with how far away it is. With location off, the list is by name and says **Location is off, so places are sorted by name. Allow location to see the nearest first.**
5. Tap the account.

### Check in

1. The account's screen shows its name, type, code and territory, and whether its location is **Verified** or **Not verified**. When today's plan has it, the bar says **Stop … of …**.
2. If the account has a known place, a map shows it with its geofence and where you are, and a pill below it:
   - **Inside the geofence · … m** in green.
   - **… m away, outside the geofence** in amber.
   - **Place not verified yet** when its location hasn't been verified.
   Tap **Locate again** for a fresh fix.
3. On the **Visit** card, tap **Check in**. If it is planned for today, the card says **Planned for today.** and the check-in carries the planned visit.
4. The card turns into **Checked in at** the time, with **In progress** and how long you have been there. **Home** shows **In a visit at** the account until you check out.

If you are checked in somewhere else, the card says **You are checked in at …. Checking in here checks you out there.**

### Do the visit's work

Under **On this visit**, the screen lists what you can do here, each only with its permission and module:

- The visit's forms ([Fill a form](fill-a-form.md)); a form sent from this visit shows **Sent**.
- **New order** ([Take an order](place-an-order.md)).
- **Collect payment** ([Collect a payment](collect-a-payment.md)), with what the account owes.
- **Record sell-through** ([Record sell-through](record-sell-through.md)).
- **Count stock** ([Count stock](count-stock.md)).
- **Forecast by item** ([Record a forecast](record-a-forecast.md)).
- **See what it pays**: the account's prices, worked out on the phone from the price lists it keeps, before tax.

Without a visit, the same list is headed **To do here**, and shows the forms linked to the account's type that are filled on their own.

Further down: the contact, who looks after it (**Who looks after it**), its territory and address, **Contact people**, its stock, **What it owes** with credit and overdue amounts, **Open invoices**, and the orders taken here.

### Check out

1. Tap **Check out** at the foot of the account's screen.
2. The check-out records your location when the phone has a fix, and counts without one.

Ending the day checks you out of an open visit by itself, and a visit left idle for four hours is checked out by the server.

### Propose where the account is

For an account whose location isn't verified, where your organisation lets field people propose one:

1. Stand at the place. The **Where is it?** card says **Stand at the place, then find your location. A fix of 50 m or better can be proposed.**
2. Tap **Find my location**.
3. When it says **Your location is known to within … m.**, tap **Propose this location**.
4. The card says **Location proposed. Your manager decides it.** Until your manager approves it, the account stays **Not verified** and the geofence isn't checked there.

## What the system checks

- The check-in fix must not be mocked and must be accurate to 250 m or better (BR-32).
- The phone judges the geofence as the server will, from its copy of the account (BR-33). Under a required geofence, a check-in outside it is refused on the phone with the distance. Under an advisory one it goes ahead and is marked outside for review. An account without a verified location isn't checked. Inside means within the radius plus the fix's accuracy, counting at most 100 m of accuracy by default.
- The server judges every check-in again when it uploads, against the shift it finds for its time (BR-32, BR-33).
- A proposed location needs a fix of 50 m or better.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Start your day to check in.** | You aren't on duty | Start your day first |
| **You are … m away. Check in within … m of this account.** | Outside a required geofence | Go to the account and check in there |
| **Checked in … m away, outside the geofence. The visit is marked for review.** | Outside an advisory geofence | Nothing; your manager sees the flag |
| **This account has no verified location yet, so the distance is not checked.** | The account's place isn't verified | Propose its location if you are there |
| **This location is mocked. Turn off any app that fakes it.** | A location-faking app is on | Turn it off and try again |
| **Your location is not accurate enough yet. Step outside and try again.** | The fix is worse than 250 m | Step into the open |
| **Your location is only known to within … m; … m or better is needed. Step outside or wait a moment, then try again.** | Too vague to propose a location | Step outside or wait, then **Try again** |
| **This is no longer on your phone. It may have moved to someone else.** | The account left your reach | Ask your manager |
| **You are too far from this account.** (in the upload queue) | The server refused the check-in under a required geofence | See [Use the upload queue](upload-queue.md) |

## Waiting on the owner

- The maps use Google's Android key, which still has to allow the Google Play build's signing fingerprint once the app is on Google Play.
