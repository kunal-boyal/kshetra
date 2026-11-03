# Suspend or terminate a tenant

| | |
|---|---|
| **Who** | Implementation or Platform admin (`platform.tenant.manage`) |
| **Where** | Console › a tenant's page › **Tenant tools** and **Termination** |
| **Related** | [docs/runbooks/tenant-offboarding.md](../../runbooks/tenant-offboarding.md), [Bill a tenant](billing-and-invoices.md), [Find a tenant](find-a-tenant.md) |

Suspending closes a tenant for now: nobody signs in, and nothing is deleted. Terminating closes it for good when the customer leaves: a final export of all its data is prepared for you to send them, and its data is deleted 30 days later unless you undo it. The offboarding runbook keeps the order of the whole leaving process, with the customer's written confirmation; this procedure is the console's part.

## Before you start

- For a suspension: the reason, which is kept on the tenant's record. Billing suspends tenants on its own when a trial ends without a subscription, a subscription ends, or a payment stays unpaid; you don't need to.
- For a termination: the customer's written confirmation, as [the offboarding runbook](../../runbooks/tenant-offboarding.md) asks, and the tenant suspended first.

## Suspend

1. Open the tenant's page. In **Tenant tools**, select **Suspend**.
2. The console asks "Suspend {name}? Nobody there can sign in until it is reactivated." Enter **Why** (at least 3 characters).
3. Select **Suspend**. The status turns to Suspended.

Everyone's session ends on their next request, on the web and on phones. Phones keep anything not yet uploaded in their upload queue. Its people see "Your organisation's subscription is suspended. Ask an admin about billing."

## Reactivate

Every open tenant is on trial or billed (decision D134), so a tenant opens again only when one of these holds:

- It has a subscription that is still running (for example, billing suspended it for an unpaid invoice, or you suspended it yourself). It opens as Active.
- Its trial hasn't ended. It opens on Trial.
- It is a demo tenant. It opens as before.

1. On a suspended tenant's page, in **Tenant tools**, select **Reactivate**. It acts at once, without asking.
2. If the tenant has neither a running subscription nor a trial left (its trial or its subscription ended), the card says "It has no subscription and its trial has ended. Give a new trial end to reopen it on trial, or start a subscription under Billing, which reopens it." Then either:
   - enter **New trial ends on** (a day after today, within 90 days) and select **Reactivate**: it opens on Trial until the end of that day, India time, and is suspended again if no subscription starts by then; or
   - start its subscription in its **Billing** card ([Bill a tenant](billing-and-invoices.md)), which needs `platform.billing.manage`: subscribing opens it as Active and bills it.

## Terminate

1. On a suspended tenant's page, the **Termination** card explains what terminating does. Select **Terminate**.
2. The console asks "Terminate {name}? Its data is deleted on {date}, unless you undo this before then." Enter **Why**, and type the tenant's slug where it says "Type {slug} to confirm".
3. Select **Terminate** (it can be selected only once the slug matches). The status turns to Terminated, and the card says "Terminated on {date}. Its data is deleted on {date}."
4. Under **Exports for the customer**, the final export starts at once: "{time}, asked by {name}", with its status (Waiting, Preparing, then Ready).

## Send the export

1. When the export shows Ready, select **Copy a download link**. The link appears in **Download link** and is copied: "Copied. The link lasts 24 hours; send it to the customer."
2. Send the link to the customer's authorised contact. Each link you copy is recorded in the tenant's audit log.
3. If the customer needs it again after the archive is removed (Removed), select **Prepare another export**. It can't be selected while one is being prepared.

The archive is signed by the tenant's cell. The customer can check it with the cell's public key, which `pnpm archive public-key` prints, as the offboarding runbook says.

## Undo a termination

1. Before the deletion date, select **Undo termination** on the **Termination** card.
2. The console asks "Undo the termination of {name}? It is suspended again, and nothing is deleted." Select **Undo termination** again.
3. The tenant is Suspended again. **Reactivate** opens it as above, or start its subscription.

## After 30 days

A job on the tenant's cell deletes everything the tenant holds there, its audit log included, and its people's memberships and sessions; its invoices, payments and subscriptions are kept, as GST law requires. The card then says "Its data was deleted on {date}. Its invoices are kept." Nothing can be undone after that.

## What the system checks

- Only a suspended tenant can be terminated, and only with its slug typed exactly.
- A terminated tenant can't be suspended or subscribe; only a suspended one can be reactivated, and only on trial or billed (decision D134). A new trial end is refused for a tenant with a running subscription and for a demo tenant.
- Undo works only before the data is deleted.
- Suspending, reactivating, terminating, undoing and the deletion (with a count of what went) are recorded in the platform audit; each export asked for and each link copied is recorded in the tenant's own audit log.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Under **New trial ends on**: "Choose a day after today, within 90 days" | The day is today or earlier, or more than 90 days away | Choose another day |
| Under **New trial ends on**: "It has no subscription and its trial has ended: give a new trial end, or start a subscription" | Its subscription ended or was cancelled while the page was open | Give a new trial end, or start a subscription |
| "It has a subscription, so it opens without a trial" | A subscription started while the page was open | Refresh the page and select **Reactivate** without a trial end |
| Only a suspended tenant can be reactivated. | It was reactivated meanwhile | Refresh the page |
| Suspend the tenant before terminating it. | The tenant isn't suspended | Suspend it first |
| The tenant is not terminated. / The tenant’s data is deleted already. | On undo: it isn't terminated, or it is too late | Refresh the page |
| The tenant lives on cell {cell}; use that cell's console for its exports. | The tenant lives on another cell, whose own console prepares its exports | Use that cell's console |
| **Terminate** stays greyed out | **Why** is shorter than 3 characters, or the slug doesn't match | Fill both; type the slug exactly |
| The export shows Failed | Preparing the archive failed | Select **Prepare another export**; if it fails again, check the `exports` queue on [Health](cell-health.md) |
| You don't see **Tenant tools** or **Termination** | Your role can't manage tenants | Ask Implementation or a platform admin |
