# Switch modules on and off

| | |
|---|---|
| **Who** | Admin or Business head (`module.manage`). Someone with `settings.manage` but not `module.manage` sees the page with the switches greyed out and no **Save**. |
| **Where** | Web portal › **Settings** › **Organisation** › **Modules** |
| **Module** | Core |
| **Related** | [Check your plan, billing details and invoices](billing.md), [Set up roles and designations](roles-and-designations.md), [Set up the organisation and its brand](organisation-and-branding.md) |

Modules are the parts of the product your organisation uses. Your plan decides which you may use; within those, you decide which are on. Switch off what you don't use, so people don't see screens they don't need.

## Before you start

- Know what your plan includes. **Settings** › **Organisation** › **Billing** lists your plan's modules ([Check your plan, billing details and invoices](billing.md)). Without a plan, every module is open.

## The modules

| Module | What its card says | Permissions it brings |
|---|---|---|
| **Core** | People, territories, accounts, forms, shifts and tracking, visits, review, plans and metrics, dashboards, notifications, imports and exports. **Always on**. | Everything not listed below |
| **Leave and attendance** | Calendars, leave, regularisation and the attendance register. | `leave.request`, `regularisation.request`, `calendar.manage`, `leave_type.manage` |
| **Orders** (the tenant's word for orders) | Price lists, orders and their approvals. | `price_list.manage`, `order.create`, `order.create_without_shift`, `order.view`, `order.decide`, `order.line_decide`, `order.fulfil`, `scheme.manage` |
| **Account finance** (the tenant's word for account) | Finance snapshots, statements and ageing for each account, and the collections the field takes. | `finance.view`, `finance.manage`, `collection.record`, `collection.view`, `collection.confirm` |
| **Expenses** | Expense policies and claims. | `expense.claim`, `expense_policy.manage`, `expense.mark_paid` |
| **Payroll inputs** | A monthly attendance summary and a provisional pay preview. | `payroll.manage`, `payslip.view` |
| **Statutory payroll** | Salary structures, PF, ESI, professional tax, the labour welfare fund and TDS, and a monthly pay run with frozen payslips. Off until you switch it on; awaits review by a chartered accountant. | `payroll.run`, `salary.manage`, and `payslip.view` while it is on |
| **Integrations** | The public API, webhooks and ERP connections. | `api_client.manage`, `webhook.manage`, `erp.manage` (so the ERP connections go with it) |
| **Single sign-on** | Signing in to the web with your own identity provider, through OIDC or SAML. | none |
| **Advanced analytics** | Custom dashboards and scheduled reports. | `report.schedule`, `dashboard.manage` |
| **Inventory** | Live stock at each account that holds it, kept by the app from fulfilment, counts and entries, or loaded from your books. Off until you switch it on. | `stock.view`, `stock.record`, `stock.count` |

## Steps

1. Open **Settings** › **Organisation** › **Modules**. Each module shows as a card with what it brings.
2. To switch a module on, tick **On** on its card. To switch it off, clear **On**.
3. Select **Save**. The page says **Saved.**
4. Tell your people. Screens of a module switched off disappear from the web at once, and from phones at their next sync.

### What each card can show instead of a switch

- **Always on**: Core, which never switches off.
- **Not in your plan**: your plan doesn't include the module. The card says **Your plan doesn’t include this module. Ask us to add it to your plan to switch it on.** Ask the vendor.

## What the system checks

- Switching a module off hides its screens, takes its permissions from every role, and closes it for everyone. Its routes answer **This feature is switched off for your organisation.** Nothing is deleted: switch it on again and everything is there (`effectivePermissions()`, `closedByModules()`).
- A role keeps its ticked permissions while their module is off; they simply do nothing until it is on again.
- **Statutory payroll** and **Inventory** are opt-in: they stay off until you tick **On** here, even when your plan includes them (`OPT_IN_MODULES`).
- While **Integrations** is off, API clients get no tokens, webhooks send nothing and ERP connections neither read nor send; all are kept for when it is on again. The card says so.
- While **Single sign-on** is off, nobody signs in through your identity provider, and everyone signs in to the web with a one-time code. The connection is kept. The card says so, and **Settings** › **People and access** › **Single sign-on** disappears.
- A module outside your plan can't be switched on.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Your plan doesn’t include a module you switched on. Reload the page to see which modules your plan includes. | Your plan changed while the page was open, or a module isn't in it. | Reload the page. Ask the vendor to change your plan if you need the module. |
| You don't have access to this. | Your role lacks `module.manage`. | Ask an admin. |
| A module you switched on doesn't show for someone. | Their role doesn't hold that module's permissions. | Tick the permissions in their role ([Set up roles and designations](roles-and-designations.md)). |

## Waiting on the owner

- **Statutory payroll** awaits a chartered accountant's review of its rules and rates. Until then every payslip says so, and you should not switch it on for real pay.
- Plan contents and seat prices are not set yet (D3); demo plans carry fictional prices.
