# Tenant onboarding

A new customer's tenant, from an industry template or from a configuration prepared elsewhere (spec 5.14, decisions D66, D88 and D100). Phase 3's exit criterion is that this takes under a day; `apps/api/test/phase-3-exit.int.test.ts` proves every step works without anyone touching the database, and the onboarding log below records how long each real one took.

1. **Agree the basics:** the tenant's name, its slug (part of its sign-in, never changed), the template (`generic`, `agri`, `pharma` or `fmcg`), the plan, and the first admin's name and mobile number.
2. **Prepare the configuration** in staging if it needs work: create the tenant there, shape it in Settings, then export it from Settings › Export and import.
3. **Create the tenant** in the console (Tenants › New tenant): name, slug, template, cell, trial days and the first admin. Put it on its plan from the tenant's page. Where a configuration was prepared, the admin imports the file in Settings › Export and import.
4. **Billing details:** on the tenant's page, its legal name, address, state and GSTIN, the billing email, and the subscription once the trial is to end. Automatic payment starts from Settings › Billing in the portal, or from the console.
5. **First admin:** they sign in on the web with their number and the code by SMS, set up their authenticator, and fill in Settings › Organisation (the legal name prints on reports and statements). Then they add or import people, territories and accounts (imports, M19).
6. **Phones:** field users install the app from Play, sign in with their numbers and accept the tracking consent at their first punch-in.
7. Record the tenant, its template version, the date and the time each step took in the onboarding log.

## Time budget

| Step | Who | Usual time |
|---|---|---|
| 1–2. Basics and configuration | Vendor and customer | 2–4 hours, most of it the customer's choices |
| 3–4. Tenant, plan and billing | Vendor staff in the console | 15 minutes |
| 5. Admin and masters | Customer's admin | 1–3 hours, by the size of the import files |
| 6. Phones | Field users | 10 minutes each, in parallel |

## Onboarding log

| Tenant | Template (version) | Date | Started → first punch-in |
|---|---|---|---|
