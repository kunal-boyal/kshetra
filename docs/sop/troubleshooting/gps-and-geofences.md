# Fix location, tracking and geofence problems

| | |
|---|---|
| **Who** | The field person; their manager (`submission.review`, `trail.view`); the tenant's admin (`settings.manage`) |
| **Where** | Field app › **Start day**, the day's card on **Home**, **Keep your route recorded**, a visit's **Check in**; web portal › **People** › the person, **Review**, **Settings** › **Rules**, **Settings** › **Account types** |
| **Module** | Core |
| **Related** | [Start your day](../field/start-your-day.md), [Visit an account](../field/visit-an-account.md), [Fill a form](../field/fill-a-form.md), [Upload queue and sync](upload-queue-and-sync.md), [Photos](photos.md) |

The app records a person's location only while they are on duty, between **Start day** and **End day** (the tenant's words, such as **Punch in** and **Punch out** in the agri template). Every punch, check-in and form carries a location the server checks. This procedure covers the location not being found, the route not being recorded, records refused or flagged for their location, and geofences.

## Before you start

- On the phone, the person's day card on **Home** shows **Tracking**, **Paused** or **Not recording**.
- In the portal, **People** › the person › **Phone** shows **Battery optimisation** ("On: the phone may stop the app in the background" or **Off**) and **Clock difference**, from the phone's last report.

## What you see, and what to do

### The location can't be found at Start day, End day, a check-in or a form

| What you see | What it means | What to do |
|---|---|---|
| **Allow location to start or end the day.** | The app may not use location | Tap **I agree, find my location** again and allow location when the phone asks. If the phone no longer asks, open the phone's settings for the app and allow location. |
| **Your location could not be found. Step outside and try again.** | No fix came | Step outside, wait a moment, try again. Check location is on in the phone's quick settings. |
| **Your location is not accurate enough yet. Step outside and try again.** | The fix is worse than 250 m | Step into the open, away from tall buildings, and try again. |
| **This location is mocked. Turn off any app that fakes it.** | The phone reports the fix as faked by an app | Uninstall or turn off the app that changes the location, and turn off any mock location setting in the phone's developer options. The refusal is reported to the server (see "Fake locations" below). |
| **Start your day to check in.** or **Start your day before submitting this form.** | No day is open | Tap **Start day** first. |

### The route isn't recorded

The day card shows **Not recording**, the person gets **Your location stopped** ("No location has arrived for 20 minutes. Open the app to record again."), and after 40 minutes their manager gets **No location from …**. On the manager's **Day replay** the gap shows as **No location from … to …**.

1. On the phone, tap **Record again** on the day card. If recording can't start, or the person taps **Fix this**, the app opens **Keep your route recorded**.
2. Under **On this phone**, read the checks:
   - **Location all the time**: **Allowed** or **Not allowed**. It must be **Allowed**: the route is recorded with the screen off.
   - **Battery use for this app** (Android): **Restricted** or **Unrestricted**. It should be **Unrestricted**.
3. Follow the steps for the phone's maker, shown under **On … phones**, and tap **Open app settings** to make the changes. The app never changes these itself.
4. Go back and tap **Record again**.

The steps the screen gives for each maker:

| Phone | Steps |
|---|---|
| Xiaomi, Redmi and POCO | In app settings, set Location to "Allow all the time". Set Battery saver to "No restrictions". Turn on Autostart for this app. |
| Vivo | In app settings, set Location to "Allow all the time". Under Battery, allow high background power use. In i Manager, allow Autostart for this app. |
| Oppo, Realme | In app settings, set Location to "Allow all the time". Under Battery usage, let the app run in the background. Turn on Auto launch for this app. |
| OnePlus | In app settings, set Location to "Allow all the time". Under Battery, choose "Don't optimise" for this app. Lock the app in Recent apps so it isn't closed. |
| Samsung | In app settings, set Location to "Allow all the time". Under Battery, choose "Unrestricted". Make sure this app isn't in Sleeping or Deep sleeping apps. |
| Any other | In app settings, set Location to "Allow all the time". Set battery use for this app to unrestricted. Let the app run in the background. |

Other causes, as the day card's note says: **Restarting the phone, force-stopping the app or battery savers can stop recording.** After a restart, open the app and tap **Record again**. Tracking never starts by itself; only **Start day**, **Resume tracking** or **Record again** start it (BR-37). Signing out stops it too, and the day stays open.

A person with no signal records as usual: points wait on the phone and upload later. A person somewhere GPS can't reach may tap **Pause tracking** and choose **No GPS where I am**.

### Points refused by the server

The phone sends its points in batches. The server keeps a point only when it passes every check, and refuses the rest for good (BR-36, `pointRejection()`). The phone already drops what the server would refuse, so a refusal is rare; nobody sees a message, and the route simply has a gap.

| Reason | What it means |
|---|---|
| Mocked | The point came from a faked location. |
| Inaccurate | Worse than 250 m. |
| Not your shift | The point names a day that isn't this person's, or that the server doesn't have. |
| Outside the shift | Taken more than 5 seconds before the day started, or more than 60 seconds after it ended. |
| Shift expired | Taken past **Longest shift** (14 hours by default). |
| Sync window | Taken longer ago than **Oldest record a phone may send** (72 hours by default). |

Trails keep only points of 100 m or better. A silence of more than 10 minutes between points is a gap. The **Location summary** and **GPS audit trail** reports show a day's points and gaps.

### Fake locations

When the phone refuses a faked fix (at a punch, a check-in, a form, a photo or while tracking), it tells the server, at most once an hour for each place in the app. For 30 days after, the server flags that person's forms **Fake location used** for the reviewer, with "The phone refused a fake location on …, in …". The person should remove the app that fakes the location; the flag stops by itself once 30 days pass without another report. A record whose own location is faked is refused: **Your location looks simulated. Turn off any app that changes your location, then try again.**

### "Phone clock was off"

A record shows **Phone clock was off** on **Review** or on the person's shifts when the phone's clock was more than 10 minutes from the server's when it sent the record (BR-44). It is a flag for the reviewer, never a refusal. The person's page shows the latest **Clock difference**. Ask the person to set the phone's date and time to automatic.

### Too far from the account (geofences)

Each account with a verified location has a geofence: a circle of the account's own **Geofence radius (m)**, else its type's **Boundary radius, in metres**, else the organisation's **Geofence radius** (300 m by default). A fix counts as inside when its distance is within the radius plus its accuracy, the accuracy counting up to **Most GPS accuracy counted toward the geofence** (100 m by default) (BR-33).

| What the person sees | What it means | What to do |
|---|---|---|
| **You are … m away. Check in within … m of this account.** | The account type, or the form, refuses check-ins outside the geofence | Go to the place and check in there. |
| **You are … m away. This form needs you within … m.** | The form must be filled inside the geofence | Fill it at the place. |
| **Checked in … m away, outside the geofence. The visit is marked for review.** | Outside is allowed but flagged | Nothing; the reviewer sees **Outside the geofence**. |
| **This account has no verified location yet, so the distance is not checked.** | The account has no verified location | A field user may propose one standing at the place; their manager decides. An admin may enter coordinates on the account, which count as verified. |
| **You are too far from this account.** on a refused upload | The server found the record outside a geofence that must not be left | Discard it and record it again at the place ([Upload queue and sync](upload-queue-and-sync.md)). |

If a place is always "too far" though the person is at it, the account's verified location is probably wrong. An admin corrects the coordinates on the account, or sets a larger **Geofence radius (m)** for it.

How strict a geofence is: the account type's **Outside the boundary** (**Settings** › **Account types**) is **Not checked**, **Allowed, and flagged for review** (the default) or **Refused**. A form's **Location check** may override it: **As the type sets**, **Off**, **Warn when outside** or **Must be inside**.

### Flags reviewers see

Flags never stop anything being recorded; they make the record wait for a person on **Review** (BR-50). **Review** shows each under **Why it was flagged**.

| Flag | The reviewer reads | When it is raised |
|---|---|---|
| **Outside the geofence** | | The record was outside its account's geofence under an advisory policy |
| **Photo taken far away** | "A photo was taken … m from where this was recorded." | A photo more than 150 m from its record, beyond both fixes' accuracy (each counting up to 100 m) |
| **Travelled too fast** | "… km from the … at …, only … apart: faster than … km/h." | Two of the person's records at least 5 km apart, closer in time than 100 km/h allows |
| **Many places in minutes** | "… places within …." | Three or more records within 10 minutes at different places (more than 300 m apart when they have no account) |
| **Off shift** | "Recorded outside a shift." | A form filled outside a shift, where the form allows that |
| **Fake location used** | "The phone refused a fake location on …, in …." | The phone refused a faked fix in the last 30 days |
| **Phone clock was off** | | The phone's clock was more than 10 minutes out |

An admin can switch each of the five checks above **Phone clock was off** off under **Settings** › **Rules** › **Evidence checks** ("Flags for reviewers. They never stop anything being recorded, and a flagged record waits for a person."). A reviewer deciding a flagged record looks at the note, the photos and the map, then approves or rejects with a reason; bulk approval leaves flagged records alone.

## What the system checks

- A punch needs a real fix of 250 m or better (`punchFixIssue()`); a record's fix must also be at most 2 minutes from its capture, on the person's own open day unless the form allows off-duty capture, and inside **Oldest record a phone may send** (BR-32).
- Points count only when real, 250 m or better, on the sender's own day, within its start less 5 seconds and end plus 60 seconds, within **Longest shift** and the sync window (BR-36).
- A device clock more than 10 minutes out flags what it sends (BR-44, `clockSkewed()`).
- Inside a geofence is distance within radius plus capped accuracy (BR-33, `geofenceResult()`); anomaly flags are BR-50 (`anomalyFlags()`).

## Waiting on the owner

- Background location needs a development build of the app; Expo Go can't record the route with the screen off.
- The device protocol (spec 14.5), including the battery steps above, has yet to be run on two Android phones of different brands; the per-brand steps are untested on real phones.
- The app isn't on Google Play yet, so its location declarations haven't been through Google's review.
