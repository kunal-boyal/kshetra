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

1. On a suspended tenant's page, in **Tenant tools**, select **Reactivate**. It acts at once, without asking.
2. The tenant opens on Trial if its trial hasn't ended, otherwise as Active.

If the tenant was suspended because its trial ended or its subscription ended, start its subscription instead of reactivating ([Bill a tenant](billing-and-invoices.md)): subscribing opens it and bills it. A tenant reactivated without a subscription stays open and is never billed.

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
3. The tenant is Suspended again. **Reactivate** opens it, or start its subscription.

## After 30 days

A job on the tenant's cell deletes everything the tenant holds there, its audit log included, and its people's memberships and sessions; its invoices, payments and subscriptions are kept, as GST law requires. The card then says "Its data was deleted on {date}. Its invoices are kept." Nothing can be undone after that.

## What the system checks

- Only a suspended tenant can be terminated, and only with its slug typed exactly.
- A terminated tenant can't be suspended or subscribe; only a suspended one can be reactivated.
- Undo works only before the data is deleted.
- Suspending, reactivating, terminating, undoing and the deletion (with a count of what went) are recorded in the platform audit; each export asked for and each link copied is recorded in the tenant's own audit log.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This changed somewhere else. Refresh and try again. | One of: the tenant isn't suspended; it isn't terminated (on undo); its data is already deleted; or the tenant lives on another cell, whose own console prepares its exports | Refresh the page. For another cell, use that cell's console |
| **Terminate** stays greyed out | **Why** is shorter than 3 characters, or the slug doesn't match | Fill both; type the slug exactly |
| The export shows Failed | Preparing the archive failed | Select **Prepare another export**; if it fails again, check the `exports` queue on [Health](cell-health.md) |
| You don't see **Tenant tools** or **Termination** | Your role can't manage tenants | Ask Implementation or a platform admin |
