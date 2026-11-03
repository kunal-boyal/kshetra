# Standard operating procedures

How to use The Lamp's applications, step by step, as they are built today. One procedure covers one piece of work, such as "Confirm a collection" or "Onboard a tenant", and the procedures are grouped by who does the work.

The procedures describe only what the code does now. [docs/spec.md](../spec.md) remains the source of truth for what the product should do. Where the two differ, the procedure follows the code, and the difference is raised with the owner. Anything that still waits on the owner, such as an account with a provider, is marked **Waiting on the owner**, with its line in [docs/progress.md](../progress.md) under Open items.

## The applications

| Application | Who uses it | Where |
|---|---|---|
| Field app | Field people and their managers, on Android phones; works offline and uploads when there is signal | `apps/mobile` |
| Web portal | The tenant's admins, back office, managers and viewers | `apps/web` |
| Platform console | The vendor's own staff: onboarding, support and finance | `apps/console` |
| Public API | The tenant's integrators; the portal's Settings › API clients and the API's own documentation at `/v1/docs` | `apps/api` |

## The folders

| Folder | For | What it covers |
|---|---|---|
| [vendor/](vendor/README.md) | The vendor's onboarding, support and finance staff | The console: staff, onboarding a tenant, plans, billing, support access, announcements, cell health, payroll rate sets, suspending and terminating |
| [admin/](admin/README.md) | The tenant's admin | First sign-in, the portal's Settings, people, territories, accounts, imports, integrations, audit and data governance |
| [field/](field/README.md) | Field people | A day on the phone: sign in, start the day, the plan, visits and forms, orders, collections, stock, expenses, leave, end the day, the upload queue |
| [manager/](manager/README.md) | Managers and business heads | Review, approvals, the live map, attendance, journey plans, targets and the team's performance |
| [back-office/](back-office/README.md) | Back office: order desk, accounts, HR | Orders, collections, receivables, stock, imports and exports, reports, expense payouts, payroll |
| [troubleshooting/](troubleshooting/README.md) | Anyone helping a user, and users themselves | Sign-in and sessions, the upload queue and sync, GPS and geofences, photos, access and modules, notifications, with every error a user can meet |

## Roles and what they see

Every tenant starts with six roles from its template. A role is a set of permissions (spec Appendix E) with a data scope; a designation, such as a job title, never grants anything by itself. Admins may change the roles or make new ones ([admin/roles-and-designations.md](admin/roles-and-designations.md)).

| Role | Data scope | In short |
|---|---|---|
| Admin | The whole tenant | Every permission, including settings, billing and integrations |
| Business head | The whole tenant | Every business permission; no billing or integration settings |
| Manager | Their team: themselves and everyone below them | Plan, review, approve, live map, team reports; no configuration |
| Field user | Themselves | Field work, their own orders, requests and performance |
| Back office | The whole tenant | Finance, order processing, payroll inputs, expense payouts; no field work |
| Viewer | The whole tenant | Dashboards and reports, read only |

Two rules hold for every role: nobody reviews or approves their own work, and nobody gives access they don't hold themselves. A record outside someone's scope is refused; the portal and the app hide what a person can't do, but the server's check is the one that counts.

The vendor's staff are not tenant users. They have their own roles in the console, and they enter a tenant only under a support grant the tenant can see ([vendor/support-access.md](vendor/support-access.md)).

## Modules

The plan decides which modules a tenant may use; within those, the admin switches them on and off on the Modules page ([admin/modules.md](admin/modules.md)). A module that is off hides its screens, takes its permissions out of every role, and its routes answer that the module is off. Each procedure names the module it needs.

| Module | What it brings |
|---|---|
| Core | People, territories, accounts, forms, shifts and tracking, visits, review, plans and metrics, dashboards, notifications, imports and exports. Always on. |
| Leave and attendance | Calendars, leave, regularisation and the attendance register |
| Orders | Price lists, orders and their approvals, schemes |
| Account finance | Finance snapshots, statements and ageing for each account, and the collections the field takes |
| Expenses | Expense policies and claims |
| Payroll inputs | A monthly attendance summary and a provisional pay preview |
| Statutory payroll | Salary structures, statutory deductions and a monthly pay run. Off until an admin switches it on, and awaiting a chartered accountant's review |
| Integrations | The public API, webhooks and ERP connections |
| Single sign-on | Signing in to the web with the tenant's own identity provider |
| Advanced analytics | Custom dashboards and scheduled reports |
| Inventory | Live stock at the accounts that hold it. Off until an admin switches it on |

## Words that change by tenant

The product uses neutral words, and each tenant's template may rename them. The procedures use the defaults and note the template words where it helps, for example "account (distributor or retailer in the agri template)". An admin can change any of these on the Terminology page ([admin/terminology.md](admin/terminology.md)).

| Default word | Agri | Pharma | FMCG | Building materials |
|---|---|---|---|---|
| Account | Distributor, Retailer, Farmer | Doctor, Chemist, Stockist, Hospital | Distributor, Outlet | Dealer, Contractor or painter, Site |
| Field user | SME | MR | DSR | TSM |
| Activity | | Call | | |
| Journey plan | Beat plan | Tour plan | PJP | |
| Planned visit | Beat | | Beat | |
| Order | | POB | | |
| Sell-through | Liquidation | | | |
| **Start day** / **End day** | **Punch in** / **Punch out** | | | |

The account words in the first row are the template's account types, not terms; each type has its own name. The generic template's one account type is Customer.

## How to read a procedure

Each procedure has the same parts, and leaves out any part with nothing in it:

- **Who**: the roles that usually do it, with the permissions it needs in `code style`.
- **Where**: the application and the path to the screen, written as **Settings** › **Rules**.
- **Module**: the module it needs.
- **Before you start**: what must be in place first.
- **Steps**: what to do, with the screen's exact English labels in **bold**.
- **What the system checks**: the rules it applies, named by their number in spec section 7 (BR-xx).
- **If something goes wrong**: the message you see, what it means and what to do.
- **Waiting on the owner**: what can't happen yet, and why.

The procedures are in English. The apps themselves are in English and Hindi, and a Hindi reader sees the same screens with Hindi labels. Phone numbers, codes and names in the procedures are placeholders, never real ones.

## Keeping these current

A change to a screen, a label, a permission, a module or a rule that a procedure describes updates that procedure in the same pull request. The labels quoted in bold come from `packages/i18n/src/messages/en.ts`; when a key's English text changes, search `docs/sop/` for the old text.
