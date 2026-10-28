# Stage U10: Settings, chains, billing, security, developers — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Settings read as the prototype's `WebSettings`, `WebWorkflows`, `WebBilling`, `WebSecurity` and `WebDevelopers`: settings grouped under six tabs instead of about 25 pills, the organisation on one page with one Save, approval chains as a list beside the chosen chain, billing with a plan hero, a new Security and data overview, and API keys with webhooks on one Developers page.

**Architecture:** One API task (the audit entry's target label), then the settings layout, then one task a screen.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage U10; the prototype's `WebSettings.dc.html`, `WebWorkflows.dc.html`, `WebBilling.dc.html`, `WebSecurity.dc.html` and `WebDevelopers.dc.html`.

## Global constraints

- Nothing is lost: every settings page keeps its route and its link under a group; the detail pages (Rules, Terminology, Modules, SSO, Vendor support, Data export, Audit log) stay, and the new pages link to them. `/settings/api-clients` and `/settings/webhooks` redirect to `/settings/developers`.
- No new permission. A group shows only the pages the caller may open; a group with none is gone. The Security page needs `settings.manage` or `audit.view`, and shows the audit log only with `audit.view`. The Developers page shows API keys with `api_client.manage` and webhooks with `webhook.manage`.
- The organisation's one Save sends only what changed: a rename through `TenantDirectory`, the rest through `PATCH /v1/settings`. The logo still uploads when chosen, as files do.
- The audit entry's target gains `label`: the person's name and code, or the API client's name, as the actor's name is resolved; null for anything else, where the portal shows the type as now.
- Out of scope (feature decision 4): the chains page's "How people hear" card (channels are not configured per tenant yet), audit actions in words, and the prototype's settings tabs for account types, territories and metrics as separate groups (they sit under Field work).

## Review focus

1. **A caller with only some settings permissions** (a manager with `form.manage`). Only Field work shows, with only Forms. Tested.
2. **A chain with conditions.** Steps that share a condition are grouped under "When …"; a step without one says "Always". Tested.
3. **No plan, no subscription, no invoices.** The hero says there is no plan; the seats tile has no meter without a limit; the invoices table its empty state. Tested.
4. **Security for an auditor without `settings.manage`.** Only the audit log, no cards that read admin-only routes. Tested.
5. **390 px.** Group tabs scroll in their row; columns stack. Checked in the browser.

---

### Task 1: the audit target's label (API)

- `AuditEntry.target.label: string | null` (optional in the schema, as `actor.name`), filled in `AuditService.page()` from the names it already resolves, now for targets of type `user` and `api_client` too.
- [x] Tests (`test/audit.int.test.ts`): a change to a person names them as the target; a role change has a null label.

### Task 2: settings navigation

- `SETTINGS_GROUPS` in `apps/web/src/settings/settings-layout.tsx`: Organisation (organisation, rules, terminology, modules, billing), People and access (roles, designations, people fields, approval chains, security, SSO, vendor support), Field work (forms, account types, territory levels, metrics, calendars, leave types, expense policies), Commerce (catalogue, price lists), Data (configuration, data export, data requests, audit log), Developers (developers).
- A row of group links (the current one underlined in the accent), then the group's pages as the pills they are now when it has more than one. The current group is the one holding the path.
- [x] Tests (`admin.test.tsx`): the groups for an admin; a caller with only `form.manage` sees Field work alone; the current group follows the path.

### Task 3: the organisation page

- Two columns. Left: Brand (logo, brand colour with its preview and shade, display name, legal name, address, GSTIN, privacy link, time zone), then Your words (each term: the product's word, then English and Hindi, a link to Terminology). Right: Modules as `SwitchRow`s (Core locked on, later phases shown as coming), then Field rules as a `DescriptionList` (geofence, auto-approval, tracking interval, photo keeping) with a link to Rules.
- One footer: Export configuration (to Configuration) and Save, with what it came to.
- [x] Tests (`config.test.tsx`): one save sends the changed settings and the rename; a module switched off goes in `modulesOff`; words and rules shown.

### Task 4: approval chains

- `SplitDetail`: request types on the left, each with a one-line summary ("A manager above them, then Role: Head"; "No chain: the requester's manager"). The chosen chain on the right: its name and version badge, steps grouped by condition ("When Leave days more than 3", "Always"), each step numbered with who decides, its reminder and its escalation; Edit opens the editor in place. The fallback role stays above.
- [x] Tests (`chains.test.tsx`): the summaries; choosing a type shows its steps, reminder and escalation; a condition groups.

### Task 5: billing

- Two columns: a Forest plan hero (cycle pill, plan name, price, renews or trial end, module chips) beside a seats `StatTile` (meter of the limit, "N left"). Then invoices (number, period, amount, status "Paid 3 Oct" from the last payment, GST invoice button) beside "Paying" (`DescriptionList`: how, bills go to, GSTIN, with Change). Standing, details form and usage stay below.
- [x] Tests (`billing.test.tsx`): the hero and seats; "Paid" with its date; no plan.

### Task 6: Security and data

- Route `/settings/security`. Cards: Sign-in (single sign-on connected or not, authenticator asked of admins, web sessions end after 12 hours, phones per person from `deviceBinding`), How long we keep things (from the retention settings), Your data (export, vendor support on or off), each linking to its page; then the audit log (the Audit log page's filters and table, its target as the label).
- [x] Tests (`security.test.tsx`): the cards from settings; support on while a grant is active; an auditor sees only the log.

### Task 7: Developers

- Route `/settings/developers`: header "API and webhooks" with API reference and Create a key; the keys table; then each webhook as a card (URL, events as chips, a health badge from `lastDelivery`) beside its recent deliveries (time, event, code badge, duration), shown without opening.
- [x] Tests (`api-clients.test.tsx`, `webhooks.test.tsx`): both on one page; the health badge; deliveries visible.

### Task 8: finish

- [x] e2e mocks and axe for `/settings/security` and `/settings/developers`; `tools/ui-compare --only settings,workflows,billing,security,developers` (security pointing at `/settings/security`, developers at `/settings/developers`); 390 px in Hindi; the gallery; the progress row; the pull request and `pnpm verify`.
