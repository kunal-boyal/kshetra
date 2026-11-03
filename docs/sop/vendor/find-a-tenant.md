# Find a tenant

| | |
|---|---|
| **Who** | Every vendor staff member |
| **Where** | Console › **Tenants** (under **Customers**) › a tenant |
| **Related** | [Onboard a tenant](onboard-a-tenant.md), [Enter a tenant as support](support-access.md), [Suspend or terminate a tenant](suspend-terminate-a-tenant.md) |

**Tenants** lists every customer company on the product. A tenant's page brings together where it lives, its plan, billing, usage, support access and the tools to suspend or terminate it. Start here whenever a customer calls.

## Steps

1. Open **Tenants**. Four tiles sum every tenant up:
   - **Paying tenants**, with how many are in trial and how many are demo tenants. Paying means an active subscription, and never a demo.
   - **Seats in use**, against the seats bought (the seat limits of tenants that have one).
   - **People active today**: people whose session was refreshed today, on India's clock.
   - **Suspended**, of all tenants.
2. Type part of the name or slug in **Search by name or slug**, or choose a **Status**: Trial, Active, Grace period, Read only, Suspended or Terminated (**Any status** shows all). The search applies a moment after you stop typing.
3. Read the row: **Tenant**, **Slug**, **Template**, **Plan** (**No plan** when it has none), **Seats** (people who may sign in, against the plan's limit), **Cell**, **Last used**, **Trial ends** and **Status**. Ten rows show a page; select **Next** and **Previous** to move between pages.
4. Select the tenant's name to open its page.

## What a tenant's page shows

- The heading: its name, slug, template and version, and the date it became a customer; its status, plan, and **Demo tenant** for a demo.
- Tiles: **Seats** (red when more people may sign in than the plan allows), **Active today**, **Last used** and **Storage** (metered this month).
- **People active, last 30 days**: a bar a day, with the **Cell** (name, region, shared or dedicated), **Trial ends** and **Created**.
- **Plan**, **Billing** and **Usage**: see [Manage plans and a tenant's usage](plans-and-usage.md) and [Bill a tenant](billing-and-invoices.md).
- **Support access**, for Support and platform admins: see [Enter a tenant as support](support-access.md).
- **Tenant tools** (**Suspend** or **Reactivate**) and **Termination**, for Implementation and platform admins: see [Suspend or terminate a tenant](suspend-terminate-a-tenant.md).
- **Reset an authenticator**, for Support and platform admins: see [Reset a tenant user's authenticator](tenant-second-factor.md).

## What the statuses mean

| Status | What it means for the tenant's people |
|---|---|
| Trial | Everything works until **Trial ends**; its admins are reminded 7 days and 1 day before. A trial that ends without a subscription is suspended. Demo tenants never end. |
| Active | Everything works. |
| Grace period | An invoice is overdue; everything still works. |
| Read only | Overdue past the grace days: people can look but not record anything. |
| Suspended | Nobody can sign in. Nothing is deleted. |
| Terminated | Closed for good; its data is deleted 30 days after termination unless undone. |

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| No tenants here. Nothing matches. Clear the search, or create a tenant. | The search or status filter matches nobody | Clear the search and choose **Any status** |
| The server could not be reached. Check your connection, then try again. | The console can't reach the API | Select **Try again**; if it lasts, check [Read cell health](cell-health.md) |
