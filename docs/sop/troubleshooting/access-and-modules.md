# Work out why something is refused

| | |
|---|---|
| **Who** | Anyone refused; the tenant's admin (`role.manage`, `user.manage`, `module.manage`, `billing.manage`); vendor support and finance |
| **Where** | Web portal › **People** › the person, **Settings** › **Roles**, **Settings** › **Modules**, **Settings** › **Billing**, **Settings** › **Vendor support**; platform console › **Tenants** › the tenant |
| **Module** | Core |
| **Related** | [Sign-in and sessions](sign-in-and-sessions.md), [Upload queue and sync](upload-queue-and-sync.md), [Enter a tenant as support](../vendor/support-access.md), [Bill a tenant](../vendor/billing-and-invoices.md) |

The server checks every request: who is asking, what their role allows, whose records they reach, which modules are on, and whether the organisation can change things right now. The portal and the app hide what a person can't do, but a shared link, an old bookmark or a record made before a change can still meet a refusal. Find the sentence the person sees below.

## What you see, and what to do

### "You don't have access to this."

Their role doesn't hold the permission the action needs.

1. Open **People** and the person. **Role** shows their role ("The designation's own role" when it follows their designation).
2. Open **Settings** › **Roles** and that role, and check its permissions (spec Appendix E names each one).
3. Give the person a role that holds the permission, or add it to their role. A change to a role reaches everyone who holds it at their next request; a change to a person's role signs them out, so they sign in again.

Other reasons for the same sentence:

- On the phone, an admin's own powers: A phone's session never carries the permissions that change access (`role.manage`, `user.manage`, `settings.manage`, `module.manage`, `billing.manage`, `erp.manage`). Admins do those on the web, where the authenticator is asked for.
- Giving more than you hold: Nobody gives a role or changes a person's access beyond their own permissions or scope (`canGrant()`). Ask someone who holds that access.
- Acting on yourself where a rule forbids it: resetting your own phone or authenticator, or reviewing or approving your own work.

### "This is outside the people and places you look after." and "This was not found. It may have been removed."

| What you see | What it means |
|---|---|
| **This is outside the people and places you look after.** | The record is in your organisation, but outside your role's reach: **Their own**, **Their team**, **Their territories**, **Their team and territories** or **Everyone** (**Whose records it reaches** on the role). |
| **This was not found. It may have been removed.** | Nothing with that ID exists for your organisation: it was never there, it was removed, or it belongs to another organisation. The server never says which. |

For the first, check the facts that decide reach: the person's **Reports to**, their **Territories**, and for an account, who holds its slots today. A manager reaches their whole team below them; a territory scope reaches what lies in their territories. For the second, check the link came from this organisation; a photo past its keeping time also answers this way ([Photos](photos.md)).

### "This feature is switched off for your organisation."

The module the action belongs to is off.

1. Open **Settings** › **Modules** (holders of `module.manage` or `settings.manage` see it; only `module.manage` changes it).
2. Find the module. **On** ticked means it is on; **Always on** is Core; **Not in your plan** means the plan leaves it out ("Your plan doesn't include this module. Ask us to add it to your plan to switch it on.").
3. To switch it on, tick **On** and tap **Save**. The page says **Saved.**

Switching a module off hides its screens, takes its permissions from every role and makes its routes refuse; phones drop their copies of its data at the next sync. **Statutory payroll** and **Inventory** stay off until an admin switches them on. With **Integrations** off, API clients get no tokens, webhooks send nothing and ERP connections neither read nor send; with **Single sign-on** off, everyone signs in to the web with a code. A module outside the plan is for the vendor to add ([Manage plans and a tenant's usage](../vendor/plans-and-usage.md)).

### "Your organisation's subscription is read-only for now. Ask an admin about billing."

An invoice went unpaid past its grace period (BR-48), or a dedicated install's licence lapsed (BR-49). Everyone can still sign in and read; changes are refused, except what settles the bill. On phones, what people record waits in the upload queue and goes once the organisation is open again.

Everyone is told, on every screen, before they try to change anything (decision D140):

- In the portal, a red banner under the top bar says **Your organisation can only read for now: changes can’t be saved, and what you record on a phone waits to upload. Ask an admin about billing.** Holders of `billing.manage` read **Your organisation can only read for now: changes can’t be saved, and what people record on their phones waits to upload. Billing says why and what to do.**, with **Open Billing**, which opens **Settings** › **Billing**.
- In the field app, **Home** and the **Upload queue** say the same as the portal's first sentence.
- A change refused as read only makes the portal and the app check again at once, so the banner appears even if the organisation turned read only since the page opened. Once it is open again, the banner goes the next time the page or app reads who is signed in (within a minute, or on coming back to the window).

To open it again:

1. The admin with `billing.manage` (Admin by default) opens **Settings** › **Billing**. It says how things stand, for example "… has been overdue since …, so your organisation can only read for now. Pay before … to avoid suspension."
2. They settle the invoice with the vendor. Once finance records the payment, writes work again at once.

The stages are a grace period, then read only, then suspension. During grace everyone works on; only holders of `billing.manage` see an amber banner in the portal, **A payment is overdue. Everyone can keep working until {date}; after that your organisation can only read until it is paid.**, with **Open Billing**.

### "Your organisation's subscription is suspended. Ask an admin about billing."

The organisation is suspended, by unpaid billing past the read-only period or by the vendor. Nobody can sign in, and no sign-in codes are sent. Its admins talk to the vendor; the vendor's implementation staff reactivate it ([Suspend or terminate a tenant](../vendor/suspend-terminate-a-tenant.md)).

### "Your support access lets you look, not change anything."

Vendor support is in the organisation under a **See only** grant. To change something, support asks again for **See and change**, and the tenant's admin approves it at **Settings** › **Vendor support** with **Approve**. Even with **See and change**, support never holds `billing.manage`, and can't make changes that need the authenticator (a person's phone or email, an authenticator, single sign-on); the tenant's admin makes those.

### "Your organisation is being moved to a new server. You can look around; changes can be made again shortly."

The vendor is moving the organisation to another server (decision D95). Reading works; every change waits, even billing. Phones keep what people record in the upload queue. While it moves, everyone sees a blue banner in the portal, and a notice on the field app's **Home** and **Upload queue**: **Your organisation is being moved to a new server. You can look around; changes can be made again shortly, and what you record on a phone uploads then.** When the move ends, the app and the portal find the new server by themselves; the phone fetches its copies again in full. Moves follow [docs/runbooks/moving-a-tenant.md](../../runbooks/moving-a-tenant.md).

### "Your organisation has used all its seats. Ask an admin to add more."

The plan allows so many active people, and adding or reactivating one more would pass it. **People** shows "… seats used of …".

- Deactivate someone who has left (**Deactivate** on their page), then try again, or
- ask the vendor to raise the plan's seat limit. Admins can't raise it themselves.

### "Too many attempts. Wait a moment, then try again."

| Where | Limit |
|---|---|
| Signing in | Codes and wrong codes per number and per address ([Sign-in and sessions](sign-in-and-sessions.md)) |
| Any request | Each person, support grant and staff member: 600 requests a minute by default (`USER_REQUESTS_PER_MINUTE`) |
| The organisation | The plan's requests a minute, when the plan sets one |
| API clients | Each client's own limit a minute |

Wait a minute and try again; the phone's upload queue waits by itself. If one person meets it in ordinary use, something is repeating requests (a browser tab left open on a page, an integration in a loop). Vendor support can look at the cell's logs.

### "Use the mobile app for this."

Either the person's role works only on the phone (Field user, by default), so the web refuses them, or the action is one only the app does: starting a day, a visit, filling a form, sending locations. Use the app, or give the person a role that isn't phone-only.

## What the system checks

- Every route declares the permissions it needs; a route whose permissions all belong to switched-off modules answers that the module is off, not that access is missing (`closedByModules()`).
- A record outside the caller's scope answers "outside the people and places you look after"; another organisation's answers "not found" (spec 4.2).
- Nobody gives access they don't hold (`canGrant()`); phones never carry the permissions that change access (decision D101).
- Read only and suspension follow BR-48 and BR-49; seats are counted one change at a time against the plan (BR-45).

## Waiting on the owner

- Payments are off until Razorpay: invoices are paid by bank transfer and recorded by hand, so a read-only organisation opens only once the vendor's finance staff record the payment.
- Plans and prices are examples (D3).
- The server's own reason for a refusal (for example "A role cannot hold access that you do not have yourself.") is English and isn't shown; the screen shows the general sentence for the code (D42 open item).
