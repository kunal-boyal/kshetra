# Phase 4 step D5: SAP Business One — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a tenant that runs SAP Business One connects it from Settings › ERP. From then on:

- its business partners (customers), items with their prices, A/R invoices and incoming payments flow in on a schedule;
- its accepted orders flow out as sales orders.

Everything comes in through the same import targets and connection machinery as Zoho Books (D129). Nothing new writes to the tenant's data.

**Kunal's answers (2026-11-02):**

- SAP is the ERP he wants. The SAP product is SAP Business One.
- The Zoho Books work is kept: it is finished and merged first, and SAP follows as the second provider on the same design.
- There is no SAP system to test against yet, so it is built and tested against a fake. A pass against a real system follows once there is one.

The rest was confirmed the same day as recommended:

- the customer publishes the Service Layer on HTTPS 443 with a valid certificate, and D101 stays as it is;
- this plan as written, built after Zoho's parts 2 and 3.

It joins decision D129.

**Order of work in D5:**

1. Zoho part 1 (#213).
2. Zoho part 2: orders out.
3. Part 3: the portal's Settings › ERP, built for several providers.
4. SAP part 4: the connection and records in.
5. SAP part 5: orders out, and its card in the portal.

**Spec:** M20, BR-59, D101, D129. New: BR-60.

## What SAP Business One offers

From SAP's Service Layer documentation. To be confirmed against a real system and recorded in `docs/integrations/sap-business-one.md`.

### Service Layer

An OData REST API at `https://<server>:<port>/b1s/v2/` (OData v4; `v1` is OData v3), served by the customer's own or a partner-hosted server.

- **Signing in:** `POST /Login` with `CompanyDB`, `UserName` and `Password` answers a `B1SESSION` cookie, and a `ROUTEID` cookie behind a load balancer. The session ends after 30 minutes unused. `POST /Logout` ends it.
- **Paging:** `$top`, `$skip` and `@odata.nextLink`, with `Prefer: odata.maxpagesize=…`. Unlike Zoho, lists can be filtered by change: `$filter=UpdateDate ge …`.
- **What the connector reads:**
  - `BusinessPartners`: `CardCode`, `CardName`, `CardType`, `Frozen`, `BPAddresses`, user fields `U_…`;
  - `Items`: `ItemCode`, `ItemName`, `ItemsGroupCode`, `SalesUnit`, `ItemPrices[]` by price list, `Frozen`;
  - `PriceLists`;
  - `Invoices`: `DocNum`, `CardCode`, `DocDate`, `DocDueDate`, `DocTotal`, `Cancelled`;
  - `IncomingPayments`: `DocNum`, `CardCode`, `DocDate`, the totals, `PaymentInvoices[]`.
- **What the connector writes:** `Orders`, with `CardCode`, `DocDate`, `DocDueDate`, `NumAtCard` (our order number) and `DocumentLines[]` (`ItemCode`, `Quantity`, `UnitPrice`).

### Its usual setup

- The Service Layer listens on port 50000, often with a self-signed certificate, inside the customer's network.

## Global constraints

### Reaching the server (the one condition customers must meet)

The cell calls out only on 443, and only to public addresses with valid certificates (D101). The customer, or their SAP partner, must therefore publish the Service Layer at an HTTPS address on 443 with a valid certificate: a reverse proxy, or their partner's hosting. The address goes through `publicUrlIssue` and `publicFetch` like any tenant-named address. It is never a private address, and never another port.

This is recommended over relaxing D101, which would open the cell's outbound traffic to a customer's port for every tenant. An agent the customer runs on their network can come later, with Tally, for anyone who can't publish the server.

### Credentials

- The customer's SAP admin makes a dedicated B1 user for the connector. That user can read business partners, items, price lists, invoices and payments, and create sales orders.
- An admin enters the address, company database, user and password in Settings › ERP. They are checked by signing in once.
- The password is sealed under `COLUMN_KEY`, like Zoho's token: `erp_connections.credentials_sealed`, in `resealSecrets()` and `ARCHIVE_SECRET_COLUMNS`. It is never shown again.
- The session cookie is kept in the worker's memory and signed out after each run.

### Rules (BR-60)

Pure functions in `packages/shared/src/erp-sap.ts`, with fixtures FX-77 to FX-80 and FX-81 for the sales order:

- `sapCustomerRow()`:
  - the code is `CardCode`, only for `CardType = cCustomer`;
  - the territory comes from a mapped user field, else the account's present territory, else the default;
  - the address is the bill-to address;
  - `Frozen` means inactive.
- `sapItemRow()`:
  - the code is `ItemCode` and the unit is the sales unit;
  - the tax rate comes from a mapped user field, else the connection's default rate, since B1 keeps GST in tax codes, not on the item;
  - prices come from the mapped price lists.
- `sapInvoiceRow()`: `DocNum`; cancelled ones are cancelled.
- `sapPaymentRow()`: against the invoices in `PaymentInvoices`.
- `sapOrderFor()`: `NumAtCard` is our order number, with the accepted lines only.
- `sapAddressIssue()`: HTTPS, 443, public, with only a host and the `/b1s/v2` path.

### Changes to what Zoho built

- `ERP_PROVIDERS` gains `sap_b1`.
- `ErpPull` reads records through a provider seam (`ErpProviderClient`: list changed customers, items, price lists, invoices and payments; create an order), so each provider adds only its client and mappers.
- Links, runs, fingerprints, problems, the call meter and the connector's access stay as they are.
- A run asks B1 only for what changed since the last run (`UpdateDate`), and checks fingerprints as Zoho's do.

### Duplicates out

Before creating an order, the connector looks it up with `GET /Orders?$filter=NumAtCard eq '…'`. A lost answer never makes a second order.

## Review focus

1. **Addresses.**
   - A private, plain-HTTP or non-443 address is refused when saved.
   - A server whose certificate fails is refused, with words the admin can pass to their SAP partner.
2. **Credentials.**
   - The password never leaves the cell, and is never logged or shown again.
   - A changed password at SAP marks the connection `needs_reconnect`.
3. **Sessions.** A session that expires mid-run signs in again once. Two runs never share a session.
4. **Change filters.** A record changed during a run is read again next time; an `UpdateDate` window overlaps by a day.
5. **Orders out.** A timeout after SAP created the order finds it by `NumAtCard`, and creates no second order.

---

### Pull request 4: SAP Business One, the connection and records in

- [x] The provider seam in `ErpPull`. `sap_b1` in `ERP_PROVIDERS`. `credentials_sealed`, and an `endpoint` column for the server address.
- [x] `SapB1` client: sign in, paging, change filters and sign out, through `publicFetch`. `FakeSapB1` for tests (`SAP_B1_API=memory`).
- [x] The BR-60 rules and fixtures. The mappings: account type, territory user field, default territory, price lists, units, tax rate field and default.
- [x] Routes:
  - `POST /v1/erp-connections/sap-b1`, which checks the details by signing in, then saves them sealed;
  - the existing settings, runs and disconnect routes, shared with Zoho.
- [x] Cross-tenant fixtures, `pnpm openapi`, docs (`docs/integrations/sap-business-one.md`, D129, spec BR-60, services and security).
- [x] Integration tests against `FakeSapB1`:
  - connecting with good and wrong details;
  - a private or wrong-port address refused;
  - a full read, then a changes-only read;
  - an expired session mid-run;
  - the module off;
  - disconnecting.

### Pull request 5: SAP Business One, orders out and the portal

- [x] Accepted orders as B1 sales orders, found by `NumAtCard` before creating.
- [x] The SAP card in Settings › ERP: address, company database, user and password (shown once, never read back), mappings, Sync now, runs and disconnect.
- [x] Vitest and Playwright with axe. Progress and tracker. `pnpm verify` before each merge.
- [ ] Once there is a real system: a pass against it, recorded in progress.
