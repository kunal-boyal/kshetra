# The vendor's procedures

For the vendor's own staff: onboarding (Implementation), support (Support), finance (Finance) and platform admins. You work in the platform console (`apps/console`), a separate web app from the tenant's portal, with its own sign-in. You are not a user of any tenant: you see every tenant's name, status, plan, billing and usage, but you see inside a tenant's data only under a support grant its admin approved, and everything you do is recorded in the platform audit, and, under a grant, in the tenant's own audit log.

The console's rail has three sections: **Customers** (**Tenants**, **New tenant**, **Support access**), **Money** (**Plans**, **Billing**) and **Operations** (**Health**, **Announcements**, **Staff**). You see only the entries your role allows. The bar at the top shows **Production** or **Staging** when the console serves one of them (nothing on a local build), **Your account**, the language switch and **Sign out**. Check the badge before you change anything.

## Roles in the console

| Role | Permissions (`PLATFORM_ROLE_PERMISSIONS`) | What it does |
|---|---|---|
| Platform admin | every platform permission | Everything, including inviting and disabling staff, and approving another's emergency support access |
| Implementation | `platform.tenant.manage` | Creates, suspends, reactivates and terminates tenants; announcements |
| Support | `platform.support.request` | Sees tenants and asks for support access; resets a tenant user's lost authenticator |
| Finance | `platform.plan.manage`, `platform.billing.manage` | Plans, billing details, subscriptions, invoices, payments, billing settings and payroll rate sets |

Every staff member, whatever the role, can read the tenants, plans, invoices, billing settings, payroll rate sets, announcements and cell health.

## Procedures

| Procedure | What it is for | Who |
|---|---|---|
| [Sign in and look after your account](sign-in-and-your-account.md) | First sign-in from a setup link, the password and authenticator, signing in, changing your password | Every staff member |
| [Manage staff](manage-staff.md) | Invite someone, choose their role, reset a lost password or authenticator, disable someone; the first admin from the command line | Platform admin |
| [Find a tenant](find-a-tenant.md) | The Tenants page, its figures and filters, and what a tenant's page shows | Every staff member |
| [Onboard a tenant](onboard-a-tenant.md) | **New tenant** from a template with its first admin, then its plan and billing details | Implementation, Finance |
| [Manage plans and a tenant's usage](plans-and-usage.md) | Plans, their modules and limits; a tenant's plan, modules added for it, its own limits; usage | Finance |
| [Bill a tenant](billing-and-invoices.md) | Billing details, subscriptions, automatic payment, invoices, payments, unpaid tenants, billing settings | Finance |
| [Enter a tenant as support](support-access.md) | Ask for a grant, emergency approval, open the portal, what the tenant sees, end a grant | Support, Platform admin |
| [Reset a tenant user's authenticator](tenant-second-factor.md) | When a tenant's only admin has lost their authenticator and recovery codes | Support |
| [Announce something to tenants](announcements.md) | A message in the portal, on phones or both, for every tenant or some | Implementation |
| [Read cell health](cell-health.md) | The Health page: each figure, each issue and what to do | Every staff member |
| [Keep payroll rate sets](payroll-rate-sets.md) | **Billing** › **Payroll rates**: add a rate set, record a chartered accountant's review | Finance |
| [Suspend or terminate a tenant](suspend-terminate-a-tenant.md) | Suspend and reactivate; terminate, the final export, undo, and the deletion 30 days on | Implementation |
| [Licences and moving a tenant](licences-and-tenant-moves.md) | Pointers to the runbooks for dedicated installs and moving a tenant between cells | Platform admin |

The tenant's own side of these, such as what the first admin does after onboarding or how an admin approves your support request, is in [../admin/](../admin/README.md). Runbooks for operations are in [docs/runbooks/](../../runbooks/).

## Two things to know about messages

- Refusals say why. When the server refuses something with a reason of its own, such as "Add the tenant’s billing details first." or "Suspend the tenant before terminating it.", the console shows that reason (for a conflict, a refusal of access, something not found, or a used ID). The server's reasons are in English; in Hindi the console says first that it couldn't be done and that the reason follows in English. Other refusals show the error's general sentence. Each procedure's table lists the reasons you may meet there.
- Field problems show under the field, in the server's words, in English. A problem with a part no field shows, such as the tenant a support request names, shows above the form.

## Waiting on the owner

- The company's own accounts: the AWS Organization, the domain's DNS and the console's address in staging and production (`console_domain`). Until then the console runs only locally (http://127.0.0.1:5174 with `pnpm dev`); the demo on one EC2 instance doesn't serve it.
- Prices and plan contents (D3): the plans are examples with fictional prices.
- Razorpay: automatic payment is off in production (`PAYMENT_PROVIDER` is `off`); invoices are paid by bank transfer and recorded by hand.
- MSG91 with DLT for SMS codes, and Amazon SES out of its sandbox for email: tenant people can't sign in by SMS in production, and billing and trial emails don't reach customers, until both are in place.
- A chartered accountant's review of statutory payroll.
