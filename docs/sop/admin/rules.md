# Set the organisation's rules

| | |
|---|---|
| **Who** | Admin or Business head (`settings.manage`) |
| **Where** | Web portal › **Settings** › **Organisation** › **Rules** |
| **Module** | Core; the **Orders** group needs **Orders**, the **Ageing** and **Collections** groups need **Account finance**, the **Stock** group needs **Inventory** |
| **Related** | [Build and publish a form](forms.md), [Set up expense policies](expense-policies.md), [Set up leave types](leave-types.md), [Set up metrics and the score](metrics-and-score.md), [Set up the organisation and its brand](organisation-and-branding.md), [Switch modules on and off](modules.md), [Review submissions](../manager/review-submissions.md) |

**Rules** is how the apps work for your organisation: region, field work, approvals, evidence checks, notifications, how long records are kept, and maps. Set it when the organisation starts, and come back when a policy changes. One **Save** sends only what you changed, and the server checks every range.

## Before you start

- In the default templates, Admin and Business head hold `settings.manage`. It also asks them for an authenticator code when they sign in on the web.
- The **Inventory** module stays off until an admin switches it on. Until then the **Stock** group isn't shown.

## Steps

1. Open **Settings** › **Organisation** › **Rules**.
2. Change what you need in the groups below. Number fields say their range under them, such as "From 50 to 5000 metres".
3. Select **Save**. You see **Saved.** The button is greyed out until something changes.

### Region and languages

| Setting | What it does |
|---|---|
| **Time zone** | The organisation's clock. Days, periods, "today" and every scheduled job follow it. |
| **Currency** | A three-letter code, such as INR. |
| **Country for phone numbers** | Numbers without a country code belong here. A two-letter code, such as IN. |
| **Financial year starts in** | The month quarters and years of targets, leave years "with the financial year" and finance reports start from. |
| **Languages** | **English** stays on, as missing text falls back to it; tick **Hindi** to offer it. |

### Field work

| Setting | What it does |
|---|---|
| **Location every** (30 to 900 seconds) | How often a phone on duty records its place. |
| **Geofence radius** (50 to 5000 metres) | How close to an account a record must be. An account type may set its own radius instead. |
| **Most GPS accuracy counted toward the geofence** (0 to 500 metres) | A fix's accuracy is added to the radius, up to this much, so a poor fix near the edge still counts as inside. |
| **Oldest record a phone may send** (24 to 168 hours) | Records captured longer ago than this are refused when they arrive. |
| **Longest shift** (8 to 24 hours) | A shift still open after this long is closed at that time. |
| **Ask for a selfie when the day starts** | A selfie at the start of each shift. |
| **Odometer when the day starts and ends** | **Not asked**, **Asked, may be skipped**, or **Required**: a reading and a photo of it at the start and end of each shift. Shown beside the tracked distance, never in its place. Per-km claims can take their kilometres from it. |
| **One phone per person, until a manager resets it** | Binds each person to the first phone they sign in on. |

### Orders (with Orders on)

The group is headed with your word for orders.

| Setting | What it does |
|---|---|
| **Take orders on the app only after start day** (your words for orders and Start day) | A field person can't send an order from the phone while not on duty; they are asked to start their day first. Holders of `order.create_without_shift` and the order desk on the web aren't held to it. Off by default. |
| **Let the app take orders offline, sent with the next sync** (your word for orders) | On (the default), an order waits on the phone and goes when there is signal. Off, the phone sends it at once and needs a connection. |

### Approvals

| Setting | What it does |
|---|---|
| **Journey plans need their manager's approval** (the tenant's word for journey plans) | Plans go through the journey-plan approval chain before they count. |
| **Admins may unlock locked targets** | Lets holders of `target.unlock` unlock a locked target set, with a reason, and lets a targets import overwrite locked targets. Off, locked targets can't be unlocked. |
| **Credit days when an invoice gives none** (0 to 365 days) | The due date of an imported invoice that names none. |

### Evidence checks

Flags for reviewers. They never stop anything being recorded, and a flagged record waits for a person. Untick a check to switch it off (BR-50, `anomalyFlags()`):

- **Flag photos taken more than 150 m from where the form was filled**
- **Flag travel between records faster than 100 km/h**
- **Flag 3 or more records within 10 minutes at different places**
- **Flag forms filled outside a shift**
- **Flag records from phones that refused a fake location in the last 30 days**

The thresholds are fixed; the page shows the values in force.

### Forecast

| Setting | What it does |
|---|---|
| **Metric to set forecasts beside** | A money metric whose account plan the forecast's value is compared with in the forecast accuracy report. **None** leaves it out. |

### Ageing (with Account finance on)

**The bands of days past due that each balance is aged into, earliest first. Only the last band has no end.** Each band, **Band 1**, **Band 2** and so on, has **From day** and **To day**; leave **To day** empty on the last band only. The defaults are 0 to 30, 31 to 60, 61 to 90, 91 to 180 and over 180 days.

- To change a band, edit its days.
- **Add a band** adds one after the last (up to eight): the last band, if it had no end, gets 30 days, and the new band starts the day after and has no end.
- The bin button beside a band (**Remove band 2** and so on) removes it; one band always stays.
- If the bands overlap, leave a gap the wrong way round, or a band other than the last has no end, the group says **Each band must start after the one before it ends, and only the last band may have no end.** and **Save** stays greyed out until they are fixed (`bucketsIssue()`, BR-20).

A band keeps its key, so the amounts already loaded against it stay. Balance imports name each band's column by its days, such as "0-30 days".

### Collections (with Account finance on)

| Setting | What it does |
|---|---|
| **Cash from one account in a day must stay under** (in the organisation's currency, shown before the amount) | Cash at or above this from one account in a day is refused (section 269ST). Leave it blank for no limit. |

### Stock (with Inventory on)

| Setting | What it does |
|---|---|
| **Where stock comes from** | **Kept by the app**: the app keeps a ledger that fulfilment, counts and entries move. **Loaded from the books**: your books' levels are loaded by file or API and nothing else moves them. |
| **A count is flagged past this difference (%)** (0 to 100) | A stock count further than this from what the ledger expected is flagged for a manager. It still adjusts the level. |

### Notifications

| Setting | What it does |
|---|---|
| **Today's plan is sent at** | When each person is told their day's plan. |
| **Quiet hours start**, **Quiet hours end** | Notifications that aren't urgent wait until quiet hours end. Email isn't held. |

### Keeping records

| Setting | What it does |
|---|---|
| **Keep raw locations for** (7 to 90 days) | Raw points are archived, then deleted after this. |
| **Keep routes for** (90 to 1095 days) | Trails and location archives are deleted after this. |
| **Keep photos for** (3 to 60 months) | Evidence photos and signatures expire after this, by the time they were captured under. |
| **Keep notifications for** (30 to 365 days) | |
| **Keep uploaded import files for** (7 to 180 days) | |
| **Keep the audit log for** (1 to 7 years) | |

### Maps

| Setting | What it does |
|---|---|
| **Your Google Maps key for the web** | Optional. Leave empty to use ours. Limit your key to this portal's address in Google Cloud. |

## Settings that are not on this page

- **Automatic approval** of forms set to automatic review is on **Review**, for holders of `review_rules.manage`.
- The organisation's name, address, tax ID, logo, brand colour and privacy policy link are on **Settings** › **Organisation** › **Organisation**; modules on **Modules**.

## What the system checks

- Every number is within its range; the time zone, currency and country are known codes; English stays among the languages.
- The forecast metric is an active money metric.
- Ageing bands follow one another without overlapping, one to eight of them, and only the last has no end.
- Location days are archived only once no phone can still send points for them (BR-41), and points are never deleted before their day is archived.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | A value is out of range; the reason shows under the field. | Fix it and save again. |
| A group is missing | **Collections** needs **Account finance** on; **Stock** needs **Inventory** on. | Switch the module on in **Settings** › **Organisation** › **Modules** (see [Switch modules on and off](modules.md)). |
| Field records are refused as too old | They were captured before **Oldest record a phone may send**. | Raise it if phones are often offline for longer. |

## Waiting on the owner

- Maps before the pilot: the production address on the vendor's web key, and a budget alert.
- SMS notifications need MSG91 and DLT templates, and email needs Amazon SES out of its sandbox; quiet hours apply to whichever channels are live.
