# Phase 4 step D5: ERP connectors, Zoho Books first — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a tenant that keeps its books in Zoho Books connects it once from Settings. From then on:

- its customers, items with their prices, invoices and payments flow in on a schedule, through the same import targets as files and the bulk API;
- its accepted orders flow out to Zoho Books as sales orders.

Tally follows in its own plan, by XML file exchange (the phase 4 plan, D109).

**Kunal's answers:** Zoho Books first (2026-11-01, D109's inputs); Kunal creates the trial organisation and the API client and puts the keys in `.env` himself. On 2026-11-02 he confirmed the account code is Zoho's customer number, orders go out once accepted, and the rest of this plan as written. Recorded as decision D129.

**Spec:** M20 (integrations), M19 (imports), BR-51; D42, D94, D101, D121, D125. New: BR-59.

## What Zoho Books offers (checked 2026-11-02 against zoho.com/books/api/v3)

Recorded with sources in `docs/integrations/zoho-books.md`.

### OAuth

- Zoho's server-based OAuth. Authorise at `{accounts}/oauth/v2/auth` with `access_type=offline` and `prompt=consent`.
- The redirect carries `code`, `state`, `location` and `accounts-server`.
- Codes are exchanged at `{accounts}/oauth/v2/token`, with the parameters in the query string. The answer holds:
  - a refresh token, which never expires until revoked, at most 20 per user;
  - an access token for an hour, at most 10 made per 10 minutes;
  - `api_domain`.
- Calls carry the header `Authorization: Zoho-oauthtoken …` and the `organization_id` parameter.

### Data centres

Zoho has nine: com, eu, in, com.au, jp, ca, com.cn, sa, ae. We call only the hosts on a fixed list, never a host a redirect names unchecked.

### Scopes

- `ZohoBooks.contacts.READ`;
- `ZohoBooks.settings.READ`, which covers items, price books and organisations;
- `ZohoBooks.invoices.READ`;
- `ZohoBooks.customerpayments.READ`;
- `ZohoBooks.salesorders.CREATE` and `ZohoBooks.salesorders.READ`.

### Limits

- 100 calls a minute per organisation.
- Each day, by plan: Free 1,000, Standard 2,000, Professional 5,000, higher plans 10,000.
- 5 concurrent calls on the free plan, 10 on paid plans.
- Any limit answers HTTP 429.

### Lists

- Lists page with `page` and `per_page` (200), and `page_context.has_more_page` says when another page follows.
- Lists can't be filtered reliably by last change, so the connector tells changes apart itself, by a fingerprint of each record.

### Sales orders

- `POST /salesorders` takes `customer_id`, `line_items[]` (`item_id`, `quantity`, `rate`) and `reference_number`.
- There is no idempotency key, so the connector looks for its reference before it creates one.

## Global constraints

### Rules (BR-59)

Pure functions in `packages/shared/src/erp.ts`, tested with fixtures FX-70 to FX-74 (pull request 1) and FX-75 and FX-76 (pull request 2).

- **`zohoHostIssue(url, kind)`.** Accepts only:
  - accounts servers: `accounts.zoho.{com,eu,in,com.au,jp,com.cn,sa,ae}` and `accounts.zohocloud.ca`;
  - API domains: `www.zohoapis.{com,eu,in,com.au,jp,ca,com.cn,sa,ae}`.

  Both must be HTTPS on 443. Anything else is refused before a secret leaves the cell.
- **Mapping each Zoho record to a row of an existing import target.** No new write paths: every row passes that target's own `check` and `commit`, so the rules of imports (BR-42 matching, BR-51 settling) hold unchanged.
  - `customerRow(contact, settings)` → `accounts:<type>`.
    - The code is the contact's customer number (`contact_number`).
    - The territory is the custom field the settings name; otherwise the account's present territory; otherwise the connection's default territory.
    - Name, address, city, state and PIN come from the billing address. Inactive maps to `active = false`.
    - A contact without a customer number is skipped and listed in the run's problems. Vendors are never read.
  - `itemRow(item, settings)` → `items`.
    - The code is the SKU. The product is the item group, else the item's name.
    - Unit, HSN and the intra-state tax percentage come across too.
    - `rate` becomes the price in the price list the settings name.
    - An item without a SKU, or with a unit the catalogue lacks, is skipped and listed.
  - `priceBookRows(book, settings)` → `items` rows that carry `price_list`, for each per-item book the settings map to one of the tenant's price lists. Fixed-percentage books are listed and not read.
  - `invoiceRow(invoice)` → `invoices`.
    - Drafts are skipped. Void invoices become `cancelled`.
    - Number, account code (through the link to its contact), date, total and due date come across.
  - `paymentRow(payment)` → `receipts`, naming the invoices it settles.
- **`fingerprint(row)`** (in the API's `erp-pull.ts`, as it hashes with Node's crypto). A stable hash of the row a record makes. An unchanged fingerprint sends nothing, so a quiet hour costs only list calls.
- **`salesOrderFor(order, links)`.**
  - Only the accepted quantity of each accepted line goes. Free goods go at rate 0.
  - The rate is our net price before tax; Zoho applies the item's own tax.
  - `reference_number` is our order number.
  - An order whose account or any item has no Zoho link is refused with the missing links named. Its upload waits for the next run, never part of an order.
- **`callBudget(used, plan)`.** Stops a run before the day's limit, keeping 10% back, and paces at 90 a minute.

### Tables

All have RLS, keys led by `tenant_id`, and cross-tenant fixtures.

- **`cell.erp_connections`:** `(tenant_id, id, provider 'zoho_books', status, accounts_server, api_domain, organization_id, organization_name, refresh_token_sealed, settings jsonb, connected_by, connected_at, last_run_at)`.
  - Status is one of `connected`, `needs_reconnect` or `disconnected`.
  - The token is sealed with `ColumnCipher`, taken into `resealSecrets()` and `ARCHIVE_SECRET_COLUMNS`.
  - There is one connection per tenant and provider.
- **`cell.erp_links`:** `(tenant_id, connection_id, entity, external_id, local_key, fingerprint, linked_at)`.
  - `entity` is one of `account`, `item`, `invoice`, `receipt` or `order`.
  - Each is unique by external ID and by local key, within its entity.
  - Links stay after a disconnect, so a reconnection carries on where it stopped.
- **`cell.erp_runs`:** `(tenant_id, id, connection_id, kind pull|push, started_at, finished_at, status ok|partial|failed, counts jsonb, problems jsonb, calls)`.
  - Up to 200 problems a run, each `{ entity, externalId, issue }`, never a value.
  - Runs are kept 90 days by `RecordRetention`.

### The connector's identity

- A connection acts as itself, never as the admin who connected it. `Access.connector` is set, with the role `connector` and scope tenant.
- Its permissions are those its targets need: `account.import`, `catalogue.manage`, `finance.manage` and `order.view`, less any module that is off.
- Audit entries name it with a new actor kind, `connector`: an enum migration, `userActor()`, and `audit.actor_connector`.

### Module and permission

- Connectors belong to the integrations module (D125). While it is off, nothing runs and the routes answer `MODULE_DISABLED`; connections are kept.
- A new permission, `erp.manage` (spec Appendix E), is given to the admin role in every template and added to `SECOND_FACTOR_PERMISSIONS`, as connecting moves a tenant's books.

### Runs

- **Pulling:**
  - The `connectors` queue runs `erp.pull` per tenant (`perTenant: true`) every hour, by `Schedules.everyForTenants()`, and on Sync now.
  - It works in order: customers, items, price books, invoices and payments.
  - Invoices and payments are read for the last `invoiceDays` (default 180).
  - Each entity's changed rows are checked; rows with problems are dropped into the run's problems, and the rest are committed in batches of 500 in their own transaction.
- **Pushing:**
  - An outbox consumer on `order.status_changed` queues `erp.push` for orders that reach `accepted` or `partially_accepted`, with the company as supplier, while the setting `pushOrders` is on.
  - The job looks for the reference in Zoho first, creates the sales order, and records the link in one step. It is retried by the queue, and orders still waiting are tried again on the hourly run.
- **Tokens:**
  - The access token is held in the worker's memory for its hour.
  - A refused refresh marks the connection `needs_reconnect` and notifies holders of `erp.manage` (`erp.reconnect`, once a day per connection).
  - A 429 ends the run as `partial`, to carry on next time.
- **HTTP:**
  - Every call goes through `ZohoBooksApi`, which is the only class that reaches Zoho, through `publicFetch`.
  - The `ZOHO_API` setting chooses where calls go: `public` sends them to Zoho, and `memory` is `FakeZohoBooks` for tests and local work without keys.

### Settings and secrets

- `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` are added to the cell's secrets for the api and worker roles (`ROLE_SECRETS`, `infra/modules/cell/services.tf`).
- Without them, the Zoho card says the provider isn't set up on this cell, and connecting answers `ERP_NOT_CONFIGURED`.
- The redirect address is `${WEB_URL}/settings/erp/zoho`, which Kunal registers in Zoho's API console.

### Connecting (no public route)

1. The portal asks `POST /v1/erp-connections/zoho/start` with the region (India by default). The answer is Zoho's authorise address with a `state` kept in Redis for 10 minutes, bound to the tenant and the person.
2. Zoho sends the browser back to the portal page. The page posts `code`, `state` and `accounts-server` to `POST /v1/erp-connections/zoho/complete`.
3. The server checks the state and the host, exchanges the code, seals the refresh token, and lists the organisations. With one organisation it is chosen; with several, the admin picks one (`PUT …/organization`).
4. Settings are `PUT /v1/erp-connections/{id}/settings`.
5. `POST /v1/erp-connections/{id}/disconnect` revokes the token at Zoho and forgets it.

Every write is idempotent and audited (`erp.connected`, `erp.settings_changed`, `erp.disconnected`, `erp.run`), never with a token or a value read from the books.

### Routes

All are under `erp.manage`.

- `GET /v1/erp-connections`: the providers, whether each is set up on this cell, and the connection with its settings and status.
- The start, complete, organization, settings and disconnect routes described under Connecting.
- `POST /v1/erp-connections/{id}/runs`: Sync now, answering 202 with the run.
- `GET /v1/erp-connections/{id}/runs`: runs, newest first, with their problems.

### Portal

Settings › ERP (`apps/web/src/settings/erp-page.tsx`, route `/settings/erp`; the return route `/settings/erp/zoho`):

- the Zoho Books card: Connect, and the region;
- the organisation, once connected;
- the mappings:
  - the account type for customers;
  - the territory custom field and the default territory;
  - the price list for item rates;
  - price books to price lists;
  - days of invoices to read;
- Push accepted orders, on or off;
- Sync now, and the runs table with each run's problems in words;
- Disconnect, which asks first with `Confirm`;
- a notice while the connection needs reconnecting.

### Phone

Nothing changes on the phone: it receives accounts, items, prices and balances by sync as it does today.

### Words

English and Hindi: `erp.*` and `audit.actor_connector`, and `notify.erp_reconnect`, with its notification kind in `NOTIFICATION_KINDS`.

## Review focus

1. **Hosts.** The connector must never send the client secret or a token anywhere but Zoho's listed hosts, whatever the redirect says. An `accounts-server` of `https://accounts.zoho.in.evil.example` or `http://accounts.zoho.in` is refused. Tested in `zohoHostIssue` and at `complete`.
2. **Partial failure.** One bad customer must not hold back the rest; the run is `partial` and names it. A payment against an invoice not read yet (older than `invoiceDays`) still records, settling oldest first (BR-51).
3. **Duplicates out.** A push that times out after Zoho created the order must not create a second. The reference lookup finds it and links it. Tested with `FakeZohoBooks` failing after create.
4. **Limits.** At 429, the run stops cleanly and the next run carries on. A day's budget is never passed.
5. **Ownership.** Records the ERP sends never move another tenant's rows (RLS, cross-tenant fixtures). A local change to an account the ERP masters is overwritten only when Zoho's record itself changes, as its fingerprint is unchanged otherwise.

---

### Pull request 1: the connection and records in

- [x] The rules and fixtures FX-70 to FX-74; `docs/integrations/zoho-books.md` with sources.
- [x] The tables and migrations; the actor kind; `Access.connector`; `erp.manage` in templates; the settings and secrets.
- [x] `ZohoBooks` with OAuth, the host checks, pacing and budget; `FakeZohoBooks`; `ErpConnectionsService` (start, complete, organisation, settings, disconnect); the pull run on the `connectors` queue; the routes; `pnpm openapi`; cross-tenant fixtures; decision D129, spec M20, BR-59, Appendices E and F, `CLAUDE.md`, services and the security documents.
- [x] Tests:
  - unit;
  - integration against `FakeZohoBooks`: connecting, with a hostile accounts server refused; a pull of customers, items, price books, invoices and payments; a second pull that writes nothing; a partial run; a 429; reconnecting; the module off.

### Pull request 2: orders out

- [ ] `salesOrderFor()`; the push consumer and job; reference lookup before create; waiting orders retried on the hourly run; the `erp.reconnect` notification.
- [ ] Integration: an accepted order becomes one sales order, even when the first try times out after creating; a partly accepted order sends the accepted lines; an order whose account has no link waits.

### Pull request 3: the portal

- [ ] Settings › ERP with the connect flow and return page, the organisation, mappings, Sync now, runs and Disconnect.
- [ ] Vitest and Playwright with axe.
- [ ] Docs:
  - decision D129;
  - spec M20, BR-59 and Appendix E;
  - `CLAUDE.md`;
  - `docs/services.md` (Zoho Books);
  - `docs/security/data-classification.md` (the sealed token);
  - the privacy notice, if it names the ERP;
  - progress and tracker.
- [ ] `pnpm verify` before each merge, with the local services stopped.
- [ ] Once Kunal's keys are in `.env`, a pass against his trial organisation, recorded in progress: connect, pull, push one order.

**Kunal's part:**

1. Create a Zoho Books trial organisation (India).
2. Register a *Server-based Application* at api-console.zoho.in with the redirect `http://127.0.0.1:5173/settings/erp/zoho`. If Zoho refuses a plain-HTTP address, use `http://localhost:5173/settings/erp/zoho`.
3. Put `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` in `.env`.

None of this blocks pull requests 1 to 3, which run against `FakeZohoBooks`.
