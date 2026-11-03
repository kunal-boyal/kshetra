# Enter a tenant as support

| | |
|---|---|
| **Who** | Support or Platform admin (`platform.support.request`); a second Platform admin approves an emergency (`platform.support.approve_emergency`) |
| **Where** | Console › a tenant's page › **Support access**; Console › **Support access** (under **Customers**) |
| **Related** | [Reset a tenant user's authenticator](tenant-second-factor.md), [Find a tenant](find-a-tenant.md), [the tenant admin's procedures](../admin/README.md) |

You see inside a tenant only under a support grant: you ask, giving the reason, and the tenant's admin approves it for a fixed time. In an emergency a second vendor admin approves it instead, to see only and briefly, and the tenant's admins are told at once. You then open the tenant's portal from the console. Everything you do there is recorded in the tenant's own audit log as vendor support.

## Before you start

- The customer has asked for help, or there is an emergency you can name. Write the reason so the tenant's admin can judge it.
- Ask for **See only** unless you must change something. Ask for the fewest hours that will do.
- The tenant is open: on trial, active, in grace or read only. A suspended or terminated tenant can't be entered.
- You have no request or access to this tenant still waiting or open.

## Ask for access

1. Open the tenant's page. The **Support access** card lists this tenant's requests and grants, with **Ask for access** below.
2. Enter **Why** (at least 10 characters). The tenant's admin reads this before deciding.
3. Choose **Access**: **See only** or **See and change**.
4. Choose **Hours**: 1 to 8 (4 unless you change it).
5. For an emergency, tick **Emergency**: a second vendor admin approves it instead of the tenant's admin; it sees only, for at most 2 hours, and the tenant's admins are told at once.
6. Select **Ask**. The card says "Asked. The tenant’s admins have been told." or, for an emergency, "Asked. A second vendor admin must approve it."
7. Wait for the decision. The row's **Status** is Waiting until it is decided. The tenant's admin may approve it as asked, shorten it, or narrow **See and change** to **See only**; or decline it. A request nobody decides in 24 hours lapses.

## Approve another's emergency request

1. Open **Support access**. Rows marked Emergency and Waiting are waiting for a second admin.
2. Check the reason with the person who asked.
3. Select **Approve**. The console asks "Approve {name}’s emergency access to {tenant}, to see only, for {duration}? Its admins are told at once." Select **Approve** again, or **Cancel**.

You can't approve your own. Ordinary requests are approved only by the tenant's admin, never in the console.

## Open the tenant's portal

1. Open **Support access** (tick **Only mine** to see only yours), or the tenant's page.
2. In your row whose **Status** is Open, select **Open the portal**. The portal opens in a new tab, signed in as vendor support. **Until** shows when the access ends.
3. Every screen shows a banner: "You are in {organisation} as vendor support, to see only, until {time}. Everything you do is recorded." (or "to see and change").
4. Do the work. Under **See only**, every change is refused. Under either, the tenant's billing is closed to you.
5. When you are done, end the access (below) rather than leaving it to expire.

## End access

1. In the row, select **End**. The console asks "End {name}’s access to {tenant}? Any session under it ends at once."
2. Select **End** again.

You can end your own requests and grants; a platform admin can end anyone's.

## What the tenant sees

- Its admins get a notification, by email and in the portal's inbox: "Vendor support asks for access", with your name, the access, the hours and your reason; for an emergency, "Vendor support entered in an emergency", marked urgent.
- In the portal's Settings › Vendor support they see what is **Waiting for you**, what is **Open now** and what came **Earlier**, decide with **Approve** or **Decline**, end access with **End access**, and read **What vendor support did** under each grant. Their audit log marks every entry made under a grant as vendor support, and changes made on the vendor's side reach it too.
- Their side is in [the tenant admin's procedures](../admin/README.md).

## Statuses

| Status | Meaning |
|---|---|
| Waiting | Asked; nobody has decided yet |
| Open | Approved and running until **Until** |
| Declined | The tenant's admin said no; you may ask again |
| Ended | Ended early, by you, a platform admin or the tenant's admin |
| Expired | Ran to its end |
| Lapsed | Nobody decided within 24 hours |

## What the system checks

- One request or open grant per staff member per tenant at a time.
- An ordinary grant lasts 1 to 8 hours; an emergency one sees only, for 1 or 2 hours. An approval may shorten or narrow a request, never lengthen or widen it.
- Only the staff member a grant is for can open the portal under it. The link the console makes works once, within a minute.
- A support session holds every tenant permission but billing (`billing.manage`), across the whole tenant. Under **See only**, every change answers "Your support access lets you look, not change anything."
- Support never decides on its own grant, in the console or the portal.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This changed somewhere else. Refresh and try again. | You already have a request or access open for this tenant; the request was already decided or lapsed; the access already ended; or the access is no longer open | Refresh. End your earlier request before asking again; ask again if it lapsed or ended |
| You select **Ask** and nothing appears | The tenant is suspended or terminated, so it can't be entered (the console doesn't show the reason) | Check the tenant's status on its page |
| You don't have access to this. | You tried to approve your own emergency request, or to end someone else's without being a platform admin | Ask another platform admin |
| In the portal: "That support link has expired or was already used. Open the portal again from the console." | The link is older than a minute or was used | Select **Open the portal** again |
| In the portal: "Your support access lets you look, not change anything." | The grant is **See only** | Ask for **See and change** if the change is needed and the tenant agrees |
| You have been signed out. Sign in again. (in the portal) | The grant ended or expired | Ask again if the work isn't done |

## Waiting on the owner

- Amazon SES out of its sandbox: until then the tenant's admins get the request in the portal's inbox, but not by email, in production.
