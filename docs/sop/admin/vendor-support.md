# Approve or end vendor support access

| | |
|---|---|
| **Who** | Admin or Business head (`settings.manage`); seeing what support did also needs `audit.view` |
| **Where** | Web portal › **Settings** › **People and access** › **Vendor support** |
| **Module** | Core |
| **Related** | [Read the audit log](audit-log.md), [Set up sign-in security and single sign-on](security-and-sso.md) |

When you ask the vendor for help, their support staff ask here to see your organisation for a fixed time. Nobody from the vendor enters without your approval, except in an emergency approved by a second vendor admin. You approve, shorten or decline each request, and can end access at any time. Everything they do is recorded.

## Before you start

- You have asked the vendor for help, and know who will ask and why.
- Everyone holding `settings.manage` gets a **Vendor support asks for access** notification, in the inbox and by email, saying who asks, what access, for how long and why.

## Steps

### Decide a request

1. Open **Settings** › **People and access** › **Vendor support**. Requests are under **Waiting for you**, each saying who asks to see (or to see and change) your organisation, and for how many hours, then **Why: {reason}**.
2. Check the reason matches what you asked for.
3. **Access**: keep what they asked, or narrow **See and change** to **See only**. You can't widen it.
4. **For**: keep the hours they asked, or choose fewer.
5. Select **Approve**. The access starts at once and moves to **Open now**.
6. To refuse, select **Decline**, then **Decline** again to confirm. They can ask again.

### Watch and end open access

1. Under **Open now**, each grant shows the staff member, **{access}, until {time}**, the reason and who approved it.
2. Open **What vendor support did** to see each change they made, with its time, from the audit log.
3. To stop them early, select **End access**, then **End access** to confirm. Their session ends at once.

### Look back

**Earlier** lists past requests with **Vendor staff**, **Access**, **Status** (**Waiting**, **Open**, **Declined**, **Ended**, **Expired**, **Lapsed**), **Asked**, **Why** and **Closed by**.

## What vendor support sees

- While their access is open, a banner on every screen of the portal tells the vendor's staff member that they are in your organisation as vendor support, to see only or to see and change, until when, and that everything they do is recorded, with **Sign out**.
- With **See only**, they can open every screen, settings included, but every change they try is refused.
- They never hold `billing.manage`, and never decide on their own request.
- In the audit log, everything they do is marked **Vendor staff**, with the grant it was done under ([Read the audit log](audit-log.md)).

## What the system checks

- A request asks for 1 to 8 hours. You may approve fewer hours and narrower access, never more (`supportApprovalIssue()`).
- A request nobody decides lapses after a day.
- An emergency entry is read only, for 2 hours at most, approved by a second vendor admin. Everyone holding `settings.manage` gets a **Vendor support entered in an emergency** notification, and can end it here like any other.
- Access ends by itself at its end time (**Expired**), or when you end it (**Ended**).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| No requests from vendor support. | Nobody from the vendor has asked. | If you expected a request, tell the vendor. |
| A request you don't recognise | Someone at the vendor asked without your call. | **Decline** it and tell the vendor. |
| Some details need fixing. Check the highlighted fields. | The hours or access chosen are outside what was asked. | Choose within what they asked. |
| You don't have access to this. | Your role lacks `settings.manage`. | Ask an admin. |

## Waiting on the owner

- Email notifications need Amazon SES out of its sandbox in production; until then rely on the in-app inbox.
