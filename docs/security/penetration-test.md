# Penetration test: scope pack

What the penetration test vendor needs to quote, plan and run the external test of The Lamp before general availability, and yearly after (spec 13.1, phase 3's exit criteria, decisions D100 and D101). Send this page, with the ASVS review it links to, when asking vendors for quotes. Phase 3 is done only when no high or critical finding of this test remains open.

## The product

A multi-tenant field-force platform for Indian sales and service teams: field people work in an Android app (offline first, GPS during shifts, photos, orders, leave and expenses), managers and admins in a web portal, integrators through a public REST API and webhooks, and the vendor's own staff in a separate console. Each customer is a tenant; tenants share one database per cell, kept apart by PostgreSQL row-level security, permission and scope checks on every route, and a contract test that tries every route with another tenant's IDs.

- Stack: NestJS on Fastify (Node 24), PostgreSQL 18 with RLS, Redis (Valkey), S3 and CloudFront, React web apps, an Expo (React Native) Android app. AWS ap-south-1, by Terraform.
- Architecture and behaviour: [spec.md](../spec.md) (sections 4, 9 to 13), decisions in [decisions.md](../decisions.md).
- Source: the repository is public at <https://github.com/kunal-boyal/kshetra>; testers may read and run it.
- Our own review: [asvs-l2.md](asvs-l2.md), the ASVS 5.0 Level 2 self-review with every requirement's status and the accepted risks; the documents it rests on in this folder; [zap.md](zap.md), our ZAP scans.

## Kind of test

**Grey box.** Testers get accounts in every role, the API's OpenAPI document, the source and our review, so their time goes into finding what we missed rather than mapping what we can tell them. Methods: OWASP WSTG for the web apps and API, OWASP MASTG for the Android app, checked against ASVS 5.0 Level 2.

## Target: staging

The test runs against **staging**, a cell built from the same Terraform, image and settings as production, with fictional data only. Production is never tested.

| Asset | Address | In scope |
|---|---|---|
| Web portal | `https://<web_domain>` (the portal, with `/v1/*` and `/auth/*` passed to the cell) | Yes |
| Vendor console | `https://<console_domain>` (with `/platform/*` passed to the cell) | Yes |
| Cell API, direct | `https://<api_domain>`, as the phone app and API clients call it | Yes |
| Media | `https://<media_domain>`, signed links to photos and files | Yes: link signing, expiry and reach |
| API reference | `https://<api_domain>/v1/docs`, `/v1/openapi.json` | Yes |
| Android app | An APK of the staging build, given to the testers | Yes: storage, transport, the offline queue, device binding, root and mock-location handling |
| AWS account, its consoles and APIs | | No: AWS's own services are out of scope, as are AWS's rules for testing (no DoS, no testing of AWS itself) |
| Third parties | MSG91 (SMS), Expo and Firebase (push), Google Maps, Sentry, Have I Been Pwned, SES | No: only how we call them |
| Tenants' identity providers | | No: the test's own OIDC or SAML provider may be used against our SSO |
| The demo at `app.thelamp.in` | | No |
| iOS | | No: not released yet |

The staging addresses are filled in when staging is set up; they are sent to the vendor with the accounts.

## What to look at first

1. **Tenant isolation.** Reading or changing another tenant's data by any route: crafted IDs in paths, queries and bodies, sync cursors, export and report filters, media IDs and signed links, webhook and API client IDs, import files that name other tenants' records.
2. **Access within a tenant.** Each role's permissions and data scope (self, team, territory, everyone): a field person reaching a colleague's records, a manager outside their team, anyone granting access they don't hold, acting on their own record where it is forbidden (approving their own requests, setting their own targets, resetting their own device), field-level rules ([field-access.md](field-access.md)).
3. **Sign-in and sessions.** SMS codes and their limits, the authenticator and recovery codes, step-up, session ending and token revocation, device binding, choosing between tenants, single sign-on (OIDC and SAML: binding to the browser, replay, issuer and subject, domain proof), the console's password, authenticator and lockout ([authentication.md](authentication.md)).
4. **Vendor access.** Support grants: entering without one, beyond a read grant, after it ends; the console's separation from tenant tokens.
5. **The public API.** Client credentials, scopes, rate limits, bulk upserts, idempotency keys.
6. **Outbound requests.** Webhook receivers and OIDC issuers are addresses tenants name: server-side request forgery against private, metadata and special-purpose ranges, redirects and DNS rebinding.
7. **Files.** Photo uploads through presigned links, logos, import files (CSV and XLSX bombs, formulas), exports and data archives ([spec 12.2](../spec.md)).
8. **Business logic.** Prices and totals the server must compute (orders refuse prices the device changed), approval chains, expense caps and receipts, leave balances, offline records replayed or reordered, GPS evidence (mocked locations, clock skew, geofences), the offline queue's idempotency.
9. **The web apps.** XSS, the Content-Security-Policy, cookies, CSRF on cookie routes, clickjacking.
10. **The Android app.** Token storage, what is kept on the phone, certificate handling, tampering with the outbox, a rooted device.

## Accounts

Two tenants, **A** and **B**, made from the generic template in the console as a real customer is ([tenant onboarding](../runbooks/tenant-onboarding.md)), each with these people:

| Person | Role | Data scope | Signs in on |
|---|---|---|---|
| Admin | Admin | Everyone | Web, with an authenticator |
| Business head | Business head | Everyone | Web |
| Manager | Manager | Their team | Web and the app |
| Field person 1 and 2 | Field user | Self, reporting to the manager | The app |
| Back office | Back office | Everyone, for orders, fulfilment, statements and paying claims | Web |
| Viewer | Viewer | Everyone, reading targets, performance, accounts, orders and reports | Web |

The roles are the generic template's; their permissions are in the portal at Settings › Roles and in spec Appendix E.

Plus, for the whole test:
- one person who belongs to both tenants, to try choosing between them;
- an API client in each tenant, with every scope, its secret given once;
- a vendor console account for each tester, in the support role, and one platform admin account, all with authenticators;
- in tenant A, accounts, items and a price list, so orders, visits and claims can be made.

**Phone numbers and emails.** Sign-in codes go by SMS to real numbers, so the vendor gives us one Indian mobile number per person above it wants to use (a number may be the same person in both tenants), and an email per console account. We enter them; nobody else's number is used. Single sign-on is tested with the vendor's own OIDC or SAML provider, which tenant B's admin connects in Settings.

## Rules of engagement

- **When:** the agreed window, on working days, 09:00 to 19:00 IST unless agreed otherwise. Kunal is told before the first request and after the last.
- **From where:** the vendor gives us its testers' public addresses. The web firewall stays as in production: sign-in paths allow 300 attempts an address in 5 minutes, and the API its own limits ([authentication.md](authentication.md)). If they block planned work, we raise them for those addresses, not switch them off.
- **Not allowed:** denial of service or load beyond a few requests a second for automated scans; social engineering of anyone; physical attacks; testing third parties; changing or deleting data outside tenants A and B; keeping any data after the report.
- **Stop and tell us** within a day of finding anything critical, and at once for anything that reaches real people's data or another environment; carry on with the rest unless asked to stop.
- **Data:** staging holds only fictional data. Anything the testers make stays in tenants A and B, and the tenants are terminated after the retest.
- **Contact:** Kunal, by phone and email, given with the accounts; an engineer is reachable in the window to reset accounts, devices and limits.

## What we provide

The staging addresses, the accounts above, the Android APK, this pack, the [ASVS review](asvs-l2.md) and its documents, the [OpenAPI document](../../apps/api/openapi.json), and answers to questions during the window.

## What we expect back

- A report: an executive summary, the scope and method as run, and each finding with its severity (CVSS 4.0 and the vendor's rating), the affected assets and routes, steps to reproduce, evidence, and a fix suggestion.
- Findings mapped to ASVS 5.0 requirements where they fit.
- A retest of the fixed findings within 30 days of our fixes, and a letter stating the result.

## After the test

Each finding goes in the table below with its severity and the pull request that fixes it, and its ASVS row in [asvs-l2.md](asvs-l2.md) is corrected. Fixes are due: critical before general availability and within 7 days, high within 30 days, medium within 90 days, low by the next yearly test. A finding we accept rather than fix is recorded with why, as the review's accepted risks are.

| Finding | Severity | ASVS | Status | Pull request |
|---|---|---|---|---|
| | | | | |

## Before the test: our checklist

1. Staging set up from `infra/environments/staging` and deployed ([deploy](../runbooks/deploy.md)), with its own secrets, real SMS by MSG91 and email by SES.
2. The vendor chosen and booked, the window agreed, its testers' numbers, emails and addresses received.
3. Tenants A and B made in the console, their people entered with the testers' numbers, the API clients, console accounts, accounts, items and price list made.
4. An APK of the staging build, from EAS on Kunal's account (`eas build --profile preview`, with `EXPO_PUBLIC_DIRECTORY_URL` set to the staging API address).
5. The staging addresses and accounts sent to the vendor by a channel other than the one carrying the report; API client secrets and the console's setup links sent once.
6. ZAP's scans run against the release being tested ([zap.md](zap.md)), and the ASVS review checked against it.
7. Alarms on staging watched during the window, so the test's effects are seen as the vendor sees them.
