# Review submissions

| | |
|---|---|
| **Who** | Manager, Business head, Admin (`submission.review`; `submission.review_bulk` to approve several at once; `review_rules.manage`, held by Business head and Admin, to set automatic approval) |
| **Where** | Web portal › **Review**; phone › **Team** › **Review** |
| **Module** | Core |
| **Related** | [Decide approvals](approvals.md), [Plan a person's month](journey-plans.md), [Follow the team's performance](team-performance.md), [Forms](../admin/forms.md) |

Every form your team fills in the field (an activity, in the tenant's words) waits for review unless its form says otherwise. Approve it and it counts toward the person's metrics and closes their planned visit; reject it and it doesn't. Review every working day: until a submission is approved, it doesn't count.

## Before you start

- The form's **Review** setting decides what happens to its submissions: **A manager reviews each one**, **Approved by the rules** (automatic approval, below) or **No review**. An admin sets it in Settings › **Forms**.
- You see the submissions of the people in your scope only. Nobody reviews their own work.

## Steps

### On the web portal

1. Open **Review** in the left rail. Its count is what waits for you. The heading says how many wait, and, when automatic approval is on, after how many hours clean ones approve themselves.
2. Under **Show**, choose a chip: **Waiting**, **With flags** (waiting ones that carry at least one flag), **Approved** or **Rejected**.
3. To narrow the queue, choose **More filters**: **Form**, **Flag**, **Where** (**Inside the geofence**, **Outside the geofence**, **Place not verified**), **Filled from** and **Filled up to**.
4. Choose a person's name in the queue. The submission opens beside the queue (below it on a narrow screen), newest first:
   - who filled it, at which account (the tenant's word for accounts, such as distributor or retailer in the agri template) and whether it was inside the geofence, with a small map of the geofence ring and the point;
   - **Filled …, received …**: when it was filled on the phone and when it reached the server;
   - **What was filled in** and **Photos**, each photo with its time and its distance from where the form was filled. **Repeats another photo** marks a photo seen before;
   - **Show on map** to see the point on a full map;
   - **Why it was flagged**, for the checks below, in words;
   - **Decisions**: who decided it before, and when.
5. Decide:
   - To approve, choose **Approve**. A note is optional.
   - To reject, write in **Note to …** (at least 3 characters; the person sees it), then choose **Reject**.
   - To change a decision already made, choose **Reject instead** or **Approve instead**, with a note of at least 3 characters.
6. The next submission in the queue opens by itself.

### Approve the clean ones together

1. Choose the **Waiting** chip, and narrow with **More filters** if you want only some forms or dates: the filters apply.
2. Choose **Approve … clean**. It asks **Approve … waiting submissions without flags?** and says only those without flags are approved.
3. Choose **Approve … clean** again to go ahead, or **Cancel**.
4. The page says **… approved.** and **… left for a closer look.**: flagged ones, your own, ones already decided, and ones outside your scope.

At most 100 are approved in one go (`BULK_REVIEW_MAX`); choose it again for the rest.

### On the phone

1. Open the **Team** tab, then **Review**. The count beside it is what waits.
2. Each card shows the person and form, the account and time, two photos, the first words written, and its flags.
3. Choose **Approve** on the card to approve it there, or **Open** to see it whole.
4. On the submission, choose **Approve**, or **Reject**: write **Why** (at least 3 characters; the person sees it), then **Reject** again, or **Cancel**.
5. Choose **Load more** for older ones and **Check again** to read the queue afresh.

Reviewing on the phone needs a signal: decisions go straight to the server and aren't kept on the phone to send later.

### Set automatic approval

Business head or Admin (`review_rules.manage`).

1. On **Review**, go to **Automatic approval** at the foot of the page.
2. Tick **Approve automatically the forms set to automatic review**.
3. In **Wait before approving (hours)**, give how long a submission waits for a person first. The default is 24 hours.
4. Choose **Save**. Forms that arrive from then on follow these rules.

A submission waiting for automatic approval says **Approves itself … unless you decide first**; you may still decide it. Once approved this way it says **Approved automatically**.

## What the system checks

- Nobody reviews their own work, and rejecting or changing a decision needs a note of at least 3 characters (`reviewRefusal()`, spec M7).
- Flags are set when the submission arrives (BR-32, BR-33, BR-50): **Outside the geofence**, **Photo from the gallery**, **Repeated photo**, **Phone clock was off**, **Photo taken far away**, **Travelled too fast**, **Many places in minutes**, **Off shift** and **Fake location used**. A flag never stops a record being made; it makes it wait for a person. Your admin may switch the last five checks off in Settings › **Rules** › **Evidence checks**.
- **Why it was flagged** explains each anomaly flag (BR-50, `anomalyFlags()`), for example how far a photo was taken from the form, or how fast the person would have travelled between two records.
- **Phone failed its integrity check** marks a phone whose integrity verdict is not genuine (`integrityWarning()`).
- Automatic approval runs every 15 minutes. It approves only a waiting submission of a form set to **Approved by the rules**, once its wait is over, with no flags, not outside the geofence and from a phone without an integrity warning (`autoApprovable()`). One that no longer qualifies waits for a person.
- Approving a submission made in a planned visit completes that planned visit; rejecting it returns the visit to planned, or to missed once its day has ended (BR-35).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| You don't have access to this. | You tried to decide your own submission, or your role can't review. | Ask your own manager to review it. |
| Some details need fixing. Check the highlighted fields. | A rejection, or a changed decision, needs a note of at least 3 characters. | Write the note, then decide again. |
| This is outside the people and places you look after. | The person isn't in your scope. | Leave it to their manager. |
| This is no longer waiting for review. (phone) | Someone else decided it meanwhile. | Go back to the queue. |
| The server could not be reached. Check your connection, then try again. (phone) | No signal. | Try again with a signal, or review on the web. |

## Waiting on the owner

- Play Integrity verdicts aren't collected yet, so **Phone failed its integrity check** doesn't appear until they are (decision D51).
- The map in a submission needs a Google Maps key; until the vendor's production key is in place before the pilot, the portal shows **Maps need a Google Maps key. The lists here still work.** The small geofence picture still shows.
