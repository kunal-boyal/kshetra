# Licences and moving a tenant

| | |
|---|---|
| **Who** | Platform admin, with whoever runs the cells |
| **Where** | The command line on a cell (`pnpm licence`, `pnpm tenant-move`); the console shows the outcome |
| **Related** | [docs/runbooks/licences.md](../../runbooks/licences.md), [docs/runbooks/moving-a-tenant.md](../../runbooks/moving-a-tenant.md), [Find a tenant](find-a-tenant.md) |

Two pieces of vendor work have no screen in the console. Both are run from the command line, step by step, as their runbooks set out. This page says when you need them and what the console shows.

## A licence for a dedicated install

A customer who runs the product on their own dedicated install doesn't use plans and subscriptions from the console: a signed licence file states its tenant, its user cap, its modules and its expiry, and the install checks it offline (BR-49).

- When: a new dedicated install, a renewal (a month before expiry), or a change to its cap or modules.
- How: [docs/runbooks/licences.md](../../runbooks/licences.md): the vendor's key pair once, then `pnpm licence sign` and `pnpm licence check` for each licence, and the licence log.
- Expiry: the licence works to its expiry date and 30 days after; after that the tenant can only read until a renewed licence is in place.
- In the console: in licence mode the install takes its modules and cap from the licence, not from a plan, so the plan you see in a console for that tenant doesn't govern it. A tenant on a dedicated cell shows "dedicated" beside its **Cell**.

## Moving a tenant between cells

Every tenant lives in one cell. Moving one, for example to a dedicated cell or off a full one, copies everything it holds to the target cell and points its people there.

- When: a customer moves to a dedicated cell, or a cell is full.
- How: [docs/runbooks/moving-a-tenant.md](../../runbooks/moving-a-tenant.md): `pnpm tenant-move register-cell`, `start`, `export`, `import`, `finish`, then `purge` on the source, each on the cell it names; `cancel` before `finish` calls it off.
- Agree a window with the customer first. During the move people can look but not change anything ("Your organisation is being moved to a new server. You can look around; changes can be made again shortly."); phones keep their records and send them once the tenant lands.
- In the console: the tenant's **Cell** shows where it lives, on **Tenants** and its page. After the move, check its page shows the target cell, then sign in on the web and on a phone as the runbook's check says. Each cell reports on [Health](cell-health.md).
- A tenant's data exports are prepared by the console of the cell it lives on ([Suspend or terminate a tenant](suspend-terminate-a-tenant.md)).

## Waiting on the owner

- The company's AWS accounts: staging, production and any dedicated cell wait on the AWS Organization. Until then there is one cell locally and one in the demo, and nothing to move between.
