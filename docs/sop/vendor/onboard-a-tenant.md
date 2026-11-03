# Onboard a tenant

| | |
|---|---|
| **Who** | Implementation or Platform admin to create the tenant (`platform.tenant.manage`); Finance or Platform admin for its plan and billing (`platform.plan.manage`, `platform.billing.manage`) |
| **Where** | Console › **New tenant** (under **Customers**, or the button on **Tenants**); then the tenant's page |
| **Related** | [Manage plans and a tenant's usage](plans-and-usage.md), [Bill a tenant](billing-and-invoices.md), [docs/runbooks/tenant-onboarding.md](../../runbooks/tenant-onboarding.md), [the tenant admin's procedures](../admin/README.md) |

A new customer company becomes a tenant: set up from an industry template, with its first admin, on a plan, on trial or active. Most organisations are live the same day. The runbook keeps the onboarding log and the time budget; this procedure is the console's part.

## Before you start

- Agree with the customer: the organisation's name, its slug (part of its sign-in, never changed), the template, the plan, and the first admin's name and mobile number (an Indian mobile number not active in any other tenant).
- Decide whether it opens on trial, and for how many days (1 to 90; 30 unless you change it), or opens active.
- The plan is on sale (**Plans**). A tenant may also start with no plan, which leaves every module open and nothing capped.
- If the customer's configuration was prepared in another tenant (for example in staging), keep its exported file for the first admin to import (see step 9).

## Steps

1. Open **New tenant**. The page shows five steps: **Organisation**, **Template**, **First admin**, **Plan and trial** and **Review**, with what you have chosen **So far** beside them. **Continue** moves on once a step is filled; **Back** returns.
2. **Organisation:** enter **Organisation name**. **Slug** follows the name until you change it: lowercase letters, digits and hyphens, starting with a letter, 3 to 40 long. Check it: it never changes. Select **Continue**.
3. **Template:** choose the card for the customer's industry (Agri inputs, Building materials and paints, FMCG and consumer goods, Generic or Pharma). Each card shows the template's words for a field user, a journey plan and a planned visit. Everything a template sets can be changed later in the organisation's own settings. Select **Continue**.
4. **First admin:** enter **Name**, **Mobile number** (ten digits) and, if you have it, **Email (optional)**. Select **Continue**.
5. **Plan and trial:** choose the **Plan** (only plans on sale are offered; "No plan: every module open" leaves it without one). Choose **Opens as**: Trial, with its **Trial days**, or Active. Select **Continue**.
6. **Review:** check **So far**. Select **Create the tenant**. The tenant's page opens, with the template's roles, forms, metrics and settings in place and the first admin as its admin.
7. **Plan:** on the tenant's page, check its **Plan** card. Change it, add a module beyond the plan or set the tenant's own limits as agreed ([Manage plans and a tenant's usage](plans-and-usage.md)).
8. **Billing details:** in its **Billing** card, select **Add billing details** and enter its legal name, GSTIN, address, place of supply and billing email ([Bill a tenant](billing-and-invoices.md)). Start the subscription when the trial is to end, or now for a tenant that opened active.
9. Tell the first admin yourself: nothing is sent to them. Give them the web portal's address and say they sign in with their mobile number and the code that arrives by SMS. Because an admin can change who does what, the portal then asks them to set up an authenticator app. If a configuration was prepared elsewhere, they import its file in the portal's Settings. What they do next is in [the tenant admin's procedures](../admin/README.md).
10. Record the tenant in the onboarding log ([docs/runbooks/tenant-onboarding.md](../../runbooks/tenant-onboarding.md)).

## A demo tenant

The console can't make a demo tenant. A demo tenant, whose people sign in with fixed demo codes and whose trial never ends, is made on the command line: `pnpm provision … --demo` locally, or `infra/scripts/demo.sh provision` and then `demo.sh content` on the demo, as [infra/demo/README.md](../../../infra/demo/README.md) sets out. The console then shows it with **Demo tenant**, and counts it apart from paying tenants.

## What the system checks

- The slug isn't used by another tenant; the template exists; the plan is on sale.
- The first admin's number is a ten-digit Indian mobile number starting with 6 to 9, and isn't active in another tenant (a number belongs to one organisation, D103). The other tenant is never named.
- The form names the tenant's ID once, so selecting **Create the tenant** twice makes one tenant.
- A tenant on trial is reminded by email 7 days and 1 day before the trial ends, and suspended when it ends without a subscription. A tenant that opens Active has no trial end and isn't billed until a subscription starts.
- Creating a tenant is recorded in the platform audit, with its slug, template, status and plan.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Under **Slug**: "Already used by another tenant" | Another tenant has this slug; the form returns to **Organisation** | Choose another slug with the customer |
| Under **Slug**: "Use 3 to 40 lowercase letters, digits or hyphens" | The slug's shape is wrong | Fix it; it must start with a letter |
| Under **Mobile number**: "This mobile number is already in use. Use another number, or ask the person to be removed from their current organisation first." | The number is active in another tenant | Ask for another number, or for the person to be removed from their other organisation first |
| Under **Plan**: "This plan is switched off" | The plan went off sale while you filled the form | Choose another plan |
| This changed somewhere else. Refresh and try again. | Shown with a field problem above: the slug or number is taken | Fix the highlighted field |
| You don't have access to this. | Your role can't create tenants | Ask Implementation or a platform admin |

## Waiting on the owner

- MSG91 with DLT: in production the first admin's sign-in code can't go by SMS until the account, the entity's DLT registration and the template exist. Production refuses the console stand-in.
- Amazon SES out of its sandbox: until then trial reminders and billing emails reach only verified addresses.
- The field app isn't on Google Play yet, so the tenant's field people can't install it from the store.
- Seat prices and plan contents (D3): the plans are examples with fictional prices.
- The company's accounts: staging and production, and the console at its own address, wait on the AWS Organization and the domain.
