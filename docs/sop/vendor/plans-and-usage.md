# Manage plans and a tenant's usage

| | |
|---|---|
| **Who** | Finance or Platform admin (`platform.plan.manage`); every staff member reads plans and usage |
| **Where** | Console › **Plans** (under **Money**); a tenant's page › **Plan** and **Usage** |
| **Related** | [Bill a tenant](billing-and-invoices.md), [Onboard a tenant](onboard-a-tenant.md), [the tenant admin's Modules page](../admin/modules.md) |

A plan sets what a tenant may use: its modules, its prices per person, and its limits. A tenant may also have modules added beyond its plan, and limits of its own. **Usage** shows what each tenant used each month, as billing counts it.

## Before you start

- The prices and contents of real plans are the owner's decision (D3). Until then the plans are the examples, marked "(example)", at made-up prices.
- Plans are never deleted. To stop selling a plan, switch it off; tenants already on it stay on it.

## Add or change a plan

1. Open **Plans**. The table shows each **Plan** with its **Key**, **Per person a month**, **Per person a year**, **Modules**, **People limit**, **Tenants** on it and **Status** (On sale or Switched off).
2. Select **New plan**, or a plan's name to change it.
3. Enter **Key** (lowercase letters, digits and underscores; it never changes, and is read only on an existing plan), **Name in English** and **Name in Hindi**.
4. Enter **Price per person a month (₹)** (for monthly subscriptions) and **Price per person a year (₹)** (for annual ones).
5. Tick the **Modules it includes**. Core is always on. Statutory payroll and Inventory start off in every tenant even when the plan includes them; the tenant's admin switches them on.
6. Set the limits. Leave a field blank for no limit, or for the default where the help says so:

   | Field | What it limits | Blank means |
   |---|---|---|
   | **People active at once** | People who may sign in at the same time | No limit |
   | **Storage (GB)** | Files the tenant keeps | No limit |
   | **API requests a minute per client** | Each API client's requests | 300, the default |
   | **Requests a minute for the whole organisation** | Every request from the tenant's people and clients together | No limit |
   | **Heavy jobs at once** | Imports, exports, archives and recomputes running together | 2, the default |
   | **Rows per import** | Rows in one import file | 20,000, the default |
   | **Rows per export** | Rows in one export | 100,000, the default |

7. Under **Add-ons**, select **Add an add-on** for each extra the plan offers, with **Add-on key**, **Price a month (₹)** and its names; **Remove this add-on** takes one away.
8. Tick or clear **On sale**. A plan that is off isn't offered to new tenants or subscriptions.
9. Select **Add the plan** or **Save the plan**. Changing a plan says how many tenants are on it: they follow the change at once, and a module the plan no longer includes closes for them on their next request.

## Change a tenant's plan, modules or limits

1. Open the tenant's page. The **Plan** card shows its **Plan**, **Modules open**, what was **Added for this tenant**, and each limit with what it uses (for people, how many of the limit are active).
2. Select **Change the plan**.
3. Choose the **Plan**. A switched-off plan is offered only to a tenant already on it. "No plan: every module open" takes the plan away.
4. Under **Added for this tenant**, tick any module beyond the plan that this tenant alone should have.
5. For each limit, choose "As the plan says", **No limit** (or the default, for the limits that have one), or **A number for this tenant**, and enter the number.
6. Select **Save**, or **Cancel**.

Starting or changing a subscription also puts the tenant on that subscription's plan, keeping what was added for it ([Bill a tenant](billing-and-invoices.md)).

## Read a tenant's usage

The **Usage** card shows the last six months, newest first, measured every hour:

| Column | What it counts |
|---|---|
| **Seats** | Everyone active in the month, counted from their first day in it: what a monthly subscription is billed for (BR-45) |
| **Signed in** | People who signed in |
| **Storage** | The tenant's files |
| **SMS** | SMS sent for the tenant |
| **WhatsApp** | WhatsApp messages sent |
| **API calls** | Calls by its API clients |

A new tenant shows "Nothing measured yet. The first figures arrive within the hour."

## What the system checks

- Every plan includes Core, and lists each module once. A plan keeps its key.
- People active at once: when an admin would make one more person active past the limit, the portal refuses with "Your organisation has used all its seats. Ask an admin to add more." Nobody already active is signed out by lowering it.
- Billable seats are the distinct people active in the period (BR-45): someone active when the month starts counts in full; someone who starts during it counts from their first day on a monthly subscription.
- A tenant without a plan has every module open and no limits.
- The storage limit and the add-ons are recorded and shown, but nothing acts on them yet: no upload is refused for storage, and invoices carry no add-on lines. Agree either with the customer outside the product for now.
- Every change to a plan or to a tenant's plan is recorded in the platform audit with the values before and after. Other parts of the cell pick it up within half a minute.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Under **Key**: "A plan keeps its key" | A plan's key can't change | Keep the key; change the names instead |
| Under **Key**: "Already used by another plan" | On a new plan: another plan has this key | Choose another key |
| Under **Plan**: "This plan is switched off" | The plan is off sale, and the tenant isn't on it | Choose a plan on sale, or put it back on sale first |
| There is no such plan. | The plan's link is wrong | Go back to **Plans** |
| You don't have access to this. | Your role can't change plans; the form is read only for you | Ask Finance or a platform admin |

## Waiting on the owner

- D3: seat prices and plan contents. The example plans carry fictional prices.
- SMS and WhatsApp usage stays at nothing in production until MSG91 (with DLT) and a WhatsApp provider exist.
