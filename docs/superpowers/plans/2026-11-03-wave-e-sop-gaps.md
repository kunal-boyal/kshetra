# Phase 4, wave E: gaps found writing the SOPs — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** close the eleven gaps that came up while writing the standard operating procedures (`docs/sop/`, PR #236): things the server already does, or the plans already sell, that no screen offers or no rule enforces.

**Why now:** Kunal asked on 2026-11-03 to "fix all" that writing the SOPs found. The bugs, messages and documents are fixed in their own pull requests (D134 to D137). These are the gaps that need new screens or rules, so they join phase 4 under their own decision (D138), as spec 15 asks. Most are already named in the SOPs' "Waiting on the owner" and "Not offered" notes, which each step removes.

**Steps:** wave E already has E1 (scheduled reports, D122) and E2 (regional languages, removed by D116), so these are **E3 to E13**.

**Every step ends as phase 4's did:** unit, integration and cross-tenant contract tests, Playwright with axe for each new page, English and Hindi, `pnpm openapi` after route changes, its decision, `docs/progress.md`, the SOPs it touches, and `pnpm verify`.

## Decisions (Kunal chose every recommendation on 2026-11-03, D138)

1. **Naming:** wave E, steps E3 to E13.
2. **E4, who sees a claim's receipts:** everyone in reach of the claimant, the claim's approvers and their delegates, and payers once it is approved, through a media reader seam; on the phone's approval screen too.
3. **E5, the grace stage:** billing admins see a banner during dunning's grace; everyone sees one once the tenant is read only.
4. **E6, weekly offs:** dated, from today or later, because attendance, leave and the payroll estimate read history live; moving the default calendar first pins today's people to the old one; item fields are edited on the same page.
5. **E7, who reads the notification log:** `audit.view`, in the portal only.
6. **E8, what is kept of refused points:** counts by hour and reason, from the server and the phone, never a place.
7. **E9, sending one's own plan:** on the phone and on one's own web plan page; managers still generate months from routes.
8. **E10, when the person gets their archive:** once the admin closes the request as completed.
9. **E12, field photos at the storage limit:** never refused; office uploads are refused; billing admins and the vendor are warned at 80% and 100%.
10. **E13, add-ons:** effects `none`, `storageGb` and `module`; billed monthly in arrears on every plan; priced from the plan at invoice time; `extraModules` stay the vendor's free grants.

## Order

| Order | Step | Size | Pull requests |
|---|---|---|---|
| 1 | E3 Every import target on the Imports page | small | 1 |
| 2 | E5 A read-only banner for everyone | small | 1 |
| 3 | E10 Downloading My data on the phone | small | 1 |
| 4 | E11 The tenant's Maps key: map ID and a refused key | small | 1 |
| 5 | E4 Expense receipts on the web | medium | 1 |
| 6 | E9 Field users sending their own month's plan | medium | 1 |
| 7 | E7 A log of notification deliveries | medium | 1 |
| 8 | E8 A record of refused location points | medium | 2 |
| 9 | E6 Catalogue settings and calendars in Settings | large | 2 |
| 10 | E12 Enforce the plan's storage limit | medium | 1 |
| 11 | E13 Bill plan add-ons | large | 2 |

14 pull requests. All steps are independent but E13, which follows E12. Steps start after the fix pull requests (D134 to D137) merge, since several touch the same files.

---

## E3. Every import target on the Imports page

**Exists:** all 18 targets are registered on the server, with `check`, `commit` and `example()` (D111), listed in `IMPORT_TARGETS`; `ImportsService.target()` refuses a closed module's target. On the web, `TARGET_PERMISSIONS` (`apps/web/src/imports/data.ts`) and the strings `imports.target_*` and `import.field_<target>_<key>` cover all 18, but `useImportTargets()` builds only six, and `FIELD_KEYS` (`imports/shared.tsx`) lacks `stock_movements` and `stock_levels`.

- [ ] Add the twelve targets to `useImportTargets()`, grouped (`imports.group_*`), each shown only where it can succeed: its permission; `stock_levels` while `stockSource` is `books` and `stock_movements` while it is `kept`; `sell_through` when an active type gives statements; `external_metrics` when a metric has an external source.
- [ ] Add the two stock targets to `FIELD_KEYS`.
- [ ] The finished import links to where its results show (`TARGET_PAGES`, strings `import.open_*`), none where there is no page.
- [ ] Offer invoices and receipts while an ERP connection is live, with a hint that the connection writes them too.
- [ ] Tests: Vitest for which targets are offered and the link per target; one new target end to end in `e2e/imports.spec.ts`.
- [ ] Docs: `docs/sop/admin/imports.md`, `back-office/imports-and-exports.md`, `back-office/receivables-and-statements.md`, `back-office/stock.md`, `back-office/payroll.md`, `admin/calendars-and-holidays.md`.

## E4. Expense receipts on the web

**Exists:** a claim's result carries its receipts and odometer photos as media IDs; the Expenses page shows only a count. `PhotosService.url()` serves only the taker or someone whose scope reaches them, so an approver by role or a delegate (D113) outside scope can't see the receipt, and the inbox shows only the claim's title. `ApprovalsService.get()` already works out who is involved. The portal has a thumbnail pattern (`usePhotoLink`, `ChequePhoto`).

- [x] A media reader seam: `MediaReaders.register(ownerType, check)`; `PhotosService.url()` asks the owning module when the caller neither took the photo nor reaches its taker. Status checks stay.
- [x] Expenses registers `expense_claim` through `ExpenseClaimsService.readable()`: in reach, involved in its approval (`ApprovalsService.involves()`, shared with `get()`), or `expense.mark_paid` once approved.
- [x] `GET /v1/expense-claims/{id}` (`@SignedIn()`, `@Contract`, cross-tenant fixture), `OUT_OF_SCOPE` for anyone else.
- [x] `ClaimDetail` (`apps/web/src/expenses/claim-detail.tsx`): amounts, policy, flags in words, readings beside tracked km, photos that open full size; beside the Expenses list, and in place in the Approvals inbox.
- [x] The phone's `/approvals/<id>` shows the same receipts.
- [x] "Receipt seen before" links to the other claim only when the reader may read it.
- [x] Tests: an approver by role outside scope and a delegate read the claim and a receipt; a stranger is refused; another tenant `NOT_FOUND`; a rejected photo stays hidden; Vitest, Jest, Playwright.
- [x] Docs: `back-office/expense-payouts.md`, `manager/approvals.md`, CLAUDE.md's Photos section.

**As built (D142):** the reader check also gets the photo's kind, so a claim's readers see its shift's odometer photos and never the punch selfie; in the inbox the claim opens in place behind **Show the claim**, so a long inbox loads no claim until asked.

## E5. A read-only banner for everyone

**Exists:** `Access.readOnly` (dunning or a lapsed licence, BR-48, BR-49) makes the guard refuse writes with `TENANT_READ_ONLY`. `MeResult` doesn't carry it; only Settings › Billing shows the standing. The phone's outbox treats 423 as transient, so captures wait without a word.

- [ ] `MeResult` gains `readOnly` and `moving` (default false).
- [ ] `ReadOnlyBanner` in the portal's shell beside `SupportBanner`; it links billing admins to Settings › Billing; the client refreshes `me` on a `TENANT_READ_ONLY` refusal.
- [ ] Billing admins also see the grace stage ("read only from …") from `GET /v1/billing`.
- [ ] The phone: a Home card and a line on the upload queue while read only or moving.
- [ ] Strings `banner.read_only`, `banner.read_only_admin`, `banner.grace`, `banner.moving` (en, hi).
- [ ] Tests: Vitest for the shell, Jest for Home and the queue, an integration check of `/v1/me` for a tenant in dunning.
- [ ] Docs: `troubleshooting/access-and-modules.md`, `admin/billing.md`, `field/upload-queue.md`.

## E6. Catalogue settings and calendars in Settings

**Exists:** `cell.catalogue_settings` holds units, measure types, rounding, item fields and rejection reasons, changed only from templates and configuration files. `cell.calendars` holds weekly offs (undated) and the default, changed only from configuration files; the portal adds and removes holidays.

Part 1, catalogue settings (one pull request):
- [ ] `PUT /v1/catalogue/settings` (`catalogue.manage`, at the version seen, `CONFLICT` when stale), through one rule shared with `importSection()`: `checkCatalogue()`; the base unit never moves once items exist; units, measure types and rejection reasons are removed only while unused.
- [ ] Audit `catalogue.settings_changed`; `CatalogueService.touch()` and `TenantConfigService.touch()` in the same transaction.
- [ ] Settings › Catalogue › **Units and orders**: units (one and other, en and hi, the base marked), measure types, rounding with a worked line from `priceLine()` and a warning that open carts re-price, rejection reasons, and item fields with `CustomFieldsEditor`.

Part 2, calendars (one pull request):
- [ ] `PUT /v1/calendars/{key}` (create, rename, weekly offs from a date today or later) and `PUT /v1/calendars/default`, `calendar.manage`, `@InModule('leave_attendance')`.
- [ ] `cell.calendar_weekly_offs` (calendar, `from_date`, days), migrated from today's column; `forPeople()` and `offOn()` read the version in force each day; `AttendanceService.store()` reworks stored days from the change date.
- [ ] Moving the default first gives people on it the old default's key, so nobody's days move. Audit `calendar.created`, `calendar.changed`, `calendar.default_changed`.
- [ ] `CalendarListResult` keeps `weeklyOffs` for older phones and gains `weeklyOffChanges`; the phone's leave preview reads each day's version. Configuration export writes today's weekly offs; an import applies from today.
- [ ] The calendars page: **Add a calendar**, **Change weekly offs**, **Make default**, each asking first.
- [ ] Tests for both parts: removal refused while in use, stale versions, the bundle version moves, weekly offs before and after a change, past days unchanged, the default move keeps everyone's days, cross-tenant; Vitest and Playwright.
- [ ] Docs: `admin/catalogue-and-price-lists.md`, `admin/calendars-and-holidays.md`, `admin/configuration-export-import.md`, spec 5.10 and 5.11.

## E7. A log of notification deliveries

**Exists:** `cell.notification_deliveries` records every attempt (channel, status, masked address, provider reference, error, attempts, sent time), with retention and erasure. Nothing reads it.

- [ ] `GET /v1/notification-deliveries?period=&userId=&channel=&status=&cursor=` (`audit.view`, `@Contract`), each row with the event and values so the portal shows the title the person read; the first page carries the month's counts by channel and status and the SMS and WhatsApp cost units.
- [ ] An index on `(tenant_id, created_at)`.
- [ ] Settings › Data › **Notification log**: tiles per channel, chips by status, filters by person and channel, errors in words (`notification_log.error_*`); a person's page links to their rows.
- [ ] Tests: masked addresses only, scope, cross-tenant, paging; Vitest and Playwright.
- [ ] Docs: `troubleshooting/notifications.md`, `admin/audit-log.md`, spec M16.

## E8. A record of refused location points

**Exists:** `LocationsService.ingest()` judges points with `pointRejection()` (BR-36) and keeps nothing of refusals; the phone drops most refused points itself and reports only mocked fixes. The replay shows gaps with no reason.

- [ ] `cell.location_refusals`: person, shift, hour, reason, source (`server` or `phone`) and count, never a place; RLS, cross-tenant fixture, erasure, deleted with raw points by `LocationArchive`.
- [ ] `ingest()` records refusals in its transaction, once per refused point ID.
- [ ] `POST /v1/locations/refused`, idempotent, shaped like the mocked report; the phone sends `INACCURATE` and past-the-longest-shift counts per shift and hour, at most hourly (`reportRefused()`). Off-duty points are never reported.
- [ ] `TrailShift` gains `refused`; the replay shows "… points refused" with reasons in words; the GPS audit trail report adds a refused row per hour; all under `trail.view`.
- [ ] Tests: a resent batch counts once, no coordinates stored, retention, erasure, cross-tenant; tracking unit tests, Jest, Vitest.
- [ ] Docs: `manager/live-map-and-trails.md`, `troubleshooting/gps-and-geofences.md`, spec BR-36's note, `docs/store/google-play.md` (counts only, no new data type).

Two pull requests: the server and the portal; the phone.

## E9. Field users sending their own month's plan

**Exists:** `POST /v1/plans/submit` takes `visit.use` for one's own month; people may plan their own visits by hand. Where journey plan approval is on, the phone syncs only approved months, so it never sees a draft; the web plan page needs `plan_item.manage` or `route.manage`.

- [ ] `PlanItemListResult.approval` gains the send-back note.
- [ ] The phone's Plan tab gains **Next month**, read online: stops by day, the month's status (not sent, waiting, approved, sent back with its note), **Add a visit**, and **Send for approval** while approval is on and the month is draft or sent back. The plan's `approval.decided` notification opens `/plan`.
- [ ] The web plan page opens for one's own month with `visit.use`, from the account menu as **My plan**.
- [ ] Tests: own submit; another's refused without `plan_item.manage`; an empty month refused; Jest and Vitest.
- [ ] Docs: `field/todays-plan.md`, `manager/journey-plans.md`.

## E10. Downloading My data on the phone

**Exists:** an access request's archive is a ZIP kept 7 days; its link appears only to admins (`GET /v1/data-requests/{id}`); the phone shows status and the answer.

- [ ] `GET /v1/me/data-requests/{id}` (own requests only, else `NOT_FOUND`, not open to API clients) gives the download once an access request is closed as completed and while its archive is kept; reading the link is audited as the admin's is.
- [ ] The `data_request.closed` text for an access request says the copy is on My data for 7 days (en, hi).
- [ ] My data shows **Download my copy** with its size and keep-until date, opened in the system browser; online only.
- [ ] Tests: the owner gets the link only once completed; others `NOT_FOUND`; expiry; audited; Jest.
- [ ] Docs: `field/my-data-and-privacy.md`, `admin/data-requests.md`, spec 13.3.

## E11. The tenant's Maps key: map ID and a refused key

**Exists:** Settings › Rules › Maps sets `mapsWebKey`, which `useMapsKey()` prefers (D64). Advanced markers use the vendor's `VITE_GOOGLE_MAPS_MAP_ID`, which may not work with a tenant's key; a refused key shows Google's grey box; a new key needs a reload.

- [ ] `mapsWebMapId` (a new setting with a default), used only with the tenant's key, set beside it.
- [ ] `window.gm_authFailure` shows a `maps.key_refused` notice in `MapView`, with the list beside the map still readable.
- [ ] After saving a key, a line says to reload.
- [ ] Docs: CLAUDE.md's Maps line ("per-tenant keys arrive in step 16" is out of date), `admin/rules.md`.

## E12. Enforce the plan's storage limit

**Exists:** `limits.storageGb` on plans and per-tenant overrides reaches cells through `Entitlements`; `MeteringService` records `storage_bytes` hourly; nothing refuses anything.

- [ ] BR-64: `storageIssue(usedBytes, limitGb)` in `packages/shared/src/billing.ts` answers `ok`, `nearly` (80%) or `full`.
- [ ] `StorageUse` (media module) keeps each tenant's bytes in Redis for 10 minutes and adds uploads it lets through.
- [ ] `STORAGE_LIMIT` (402, spec 11.4) refuses office uploads when full: `POST /v1/imports`, the organisation logo, Tally uploads. Field photos and the system's own files (exports, archives, location archives) are never refused.
- [ ] `storage.nearly_full` and `storage.full` notify `billing.manage` holders once a month each; Settings › Billing shows used of included; the console's tenant plan card flags it.
- [ ] Tests: `storageIssue()` fixtures; refused and allowed per upload kind, notices once, no plan means open, the override; Vitest in the portal and the console.
- [ ] Docs: `vendor/plans-and-usage.md`, `admin/billing.md`, `troubleshooting/photos.md`, spec M23 and BR-64.

## E13. Bill plan add-ons

**Exists:** `PlanAddon` (key, name, monthly price) on plans, edited in the console; nothing says which tenant takes one; `BillingCycle` issues only seat lines and skips a month without seats.

- [ ] `PlanAddon.effect`, additive, default `none`: `none` (billed only), `{ storageGb: n }` (adds to the storage limit per unit), `{ module }` (opens a switchable module).
- [ ] `directory.tenant_addons` (tenant, add-on, quantity, from, to, who set it), never changed in place.
- [ ] `EntitlementsService` folds the add-ons in force into `limits.storageGb` and `modules`.
- [ ] BR-65: `addonCharge()` beside `lineAmount()`: quantity × the plan's monthly price × days held ÷ days in the month.
- [ ] `BillingCycle` adds a line per add-on, monthly in arrears on every plan (annual tenants get a monthly `addons` invoice), and issues even without seats; idempotent like its other steps.
- [ ] A move to a plan without an add-on ends it after asking; an add-on in use can't be removed from its plan.
- [ ] The console's tenant plan card gains **Add-ons** (add, change from a date, end), audited; Settings › Billing lists those in force.
- [ ] Tests: `addonCharge()` fixtures (FX-100 on); a mid-month start prorated; an annual tenant billed; the cycle run twice issues nothing twice; a storage add-on raises E12's limit; a module add-on opens it; console and portal Vitest.
- [ ] Docs: spec M23, BR-65, D90's amendment, `vendor/plans-and-usage.md`, `vendor/billing-and-invoices.md`, `admin/billing.md`.

Two pull requests: the rules, server and invoices; the console and portal.

## Not in this wave

- Metered overage (SMS beyond a pack) and caps on SMS and WhatsApp volumes.
