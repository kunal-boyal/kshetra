# SAP Business One

The second ERP connector (decision D129, BR-60), built on the same connections, runs, links and
import targets as Zoho Books (`docs/integrations/zoho-books.md`). This page records what the
connector relies on in SAP Business One's Service Layer. It was written from SAP's Service Layer
documentation, and is to be checked against a real company before a tenant uses it; there is
none yet, so it is built and tested against `FakeSapB1`.

## Reaching the Service Layer

- The Service Layer is an OData REST API (`/b1s/v2` is OData v4) on the customer's own or a
  partner-hosted server, usually on port 50000 with a self-signed certificate.
- The cell calls out only on HTTPS 443, to public addresses with valid certificates (D101). The
  customer, or their SAP partner, therefore publishes the Service Layer at an HTTPS address on 443
  with a valid certificate: a reverse proxy, or the partner's hosting. Kunal chose this on
  2026-11-02 over relaxing D101.
- The admin enters that address; `sapEndpointIssue()` refuses anything but HTTPS on 443 with a
  host, and the Service Layer's own path if any. The cell then checks the host is public
  (`publicUrlIssue`) before saving and before every call (`publicFetch`).

## Signing in

- `POST {root}/Login` with `CompanyDB`, `UserName` and `Password` answers the `B1SESSION` cookie,
  and `ROUTEID` behind SAP's load balancer. Each run signs in once, keeps the cookies, signs in
  again once if the Service Layer answers 401 (the session lapsed after its 30 minutes, or the
  server restarted), and signs out with `POST {root}/Logout` at the end.
- The customer's SAP admin makes a dedicated user for the connection. That user can read
  business partners, items, item groups, price lists, A/R invoices and incoming payments, and
  create sales orders (part 5).
- The details are checked by signing in before they are kept. The password is sealed under
  `COLUMN_KEY` (`erp_connections.credentials_sealed`, in `pnpm reseal`, left out of data
  exports) and never shown again. A sign-in SAP refuses during a run marks the connection
  `needs_reconnect` and tells the admins (`erp.reconnect`).
- The Service Layer has no call limits of its own, so a SAP run paces and counts nothing.

## What the connector reads

| Records | Call | Notes |
|---|---|---|
| Customers | `GET BusinessPartners?$filter=CardType eq 'cCustomer'` | The code is `CardCode`; the territory a user field the mappings name (`U_…`), else the account's present one, else the default; the bill-to address (`BPAddresses`, `bo_BillTo`). Frozen or invalid partners are inactive. |
| Item groups | `GET ItemGroups` | Each item's product is its group's name. |
| Items | `GET Items` | The code is `ItemCode`; the unit `SalesUnit`, else `InventoryUOM`, through the unit mappings; HSN from `ChapterID`; the GST rate from a user field the mappings name, else the default rate. An item with neither is listed (`no_tax_rate`). |
| Prices | `Items.ItemPrices` | Each mapped SAP price list (by its number) into one of the tenant's price lists. |
| A/R invoices | `GET Invoices?$filter=DocDate ge …` | The last `invoiceDays`. `DocNum` is the number; cancelled ones are cancelled. |
| Incoming payments | `GET IncomingPayments?$filter=DocDate ge …` | `DocNum` is the receipt's number; the amount is cash, transfer, cheques and cards together; `PaymentInvoices` name the invoices it settles. |

- **Paging:** lists ask for 100 records a page (`Prefer: odata.maxpagesize=100`) and follow
  `@odata.nextLink`.
- **Changes only:** unlike Zoho, the Service Layer filters by change. Each kind of record keeps
  the day it was last read through (`erp_connections.cursors`); the hourly read asks for
  `UpdateDate ge` the day before it, so nothing changed around midnight is missed. Sync now reads
  everything. Fingerprints still keep an unchanged row from being written again.
- **A known gap:** changing a price in a SAP price list may not move the item's `UpdateDate`. Sync
  now reads every price again.

**To confirm on a real company:**

- the `UpdateDate` filter's format on the customer's version;
- where the customer keeps GST rates and territories (the user fields' names);
- that `ChapterID` holds the HSN code in their localisation.

## Sales orders (part 5)

`POST Orders` with `CardCode`, `DocDate`, `DocDueDate`, `NumAtCard` (our order number) and
`DocumentLines[]` (`ItemCode`, `Quantity`, `UnitPrice`). Before creating, the connector looks the
order up with `GET Orders?$filter=NumAtCard eq '…'`, so a lost answer never makes a second.
