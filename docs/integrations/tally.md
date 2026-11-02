# Tally

The third ERP connector (decision D129, BR-61). It reuses the import targets, links, runs and connector access that Zoho Books (`docs/integrations/zoho-books.md`) and SAP Business One (`docs/integrations/sap-business-one.md`) use. This page records what the connector relies on in Tally's XML. It was written from Tally's documentation of its XML format and is to be checked against a real export before a tenant uses it. There is none yet, so it is built and tested against the fictional exports in `apps/api/test/fixtures/tally/`.

## Reaching Tally

- Tally runs on the customer's own computer, which the cell can't reach and never tries to. Records move as files, so D101 is untouched.
- **In:** an admin exports from TallyPrime and uploads the file in Settings › ERP:
  - masters: Export › Masters, all masters, XML (Data Interchange);
  - transactions: the Day Book for a period, Export, XML.
- **Out:** accepted orders come down as a Tally XML file, which the admin imports with Import › Transactions.
- An agent on the customer's computer, sending files on its own, may come later.

## Files

- **Limits:**
  - at most 20 MB, as any import file; a year's Day Book larger than that is exported a month at a time;
  - UTF-8, or UTF-16 when Unicode is chosen in the export, with or without its byte-order mark.
- **Refused before the file is kept:**
  - anything not an `ENVELOPE` of `TALLYMESSAGE`s;
  - a file of another company than the connection's (`SVCURRENTCOMPANY`; the first file names it);
  - any DOCTYPE or entity declaration.
- **Read in the worker,** a message at a time, so memory stays bounded:
  - Tally writes control characters as character references (`&#4;` before "Primary", "Any" and "Not Applicable"), which XML 1.0 forbids. They are removed first.
  - A message larger than 2 million characters, or one that doesn't parse, stops the run as `bad_file`.
- **Kept:** as an import file for the tenant's `importFileRetentionDays`; its run stays 90 days.

## What the connector reads

| Records | From | Notes |
|---|---|---|
| Groups | `GROUP`: `NAME`, `PARENT` | Remembered from every file (`erp_connections.structure`), so a Day Book uploaded alone knows which ledgers are customers. |
| Voucher types | `VOUCHERTYPE`: `NAME`, `PARENT` | Remembered too, so a renamed type such as "GST Sales" counts as a sale. |
| Customers | `LEDGER` | Only ledgers in the mapped debtor groups (default Sundry Debtors), at any depth. Fields: the first alias in `LANGUAGENAME.LIST/NAME.LIST` that is a valid account code (BR-61, Kunal's choice), the name, `ADDRESS.LIST`, `LEDSTATENAME`, `PINCODE`. The territory is the nearest group's mapped territory, else the present one, else the default. |
| Items | `STOCKITEM` | Fields: the first alias as the code, `PARENT` (stock group) as the product, `BASEUNITS` through the unit mappings, and HSN and the integrated rate from the `GSTDETAILS.LIST` in force today (`APPLICABLEFROM`), else the default rate. |
| Prices | `STOCKITEM/FULLPRICELIST.LIST` | Each mapped price level (`PRICELEVEL`) into one of the tenant's price lists, at its latest rate dated on or before today (the first slab of `PRICELEVELLIST.LIST`). |
| Invoices | `VOUCHER` of a sales type | `VOUCHERNUMBER`, `DATE`, `PARTYLEDGERNAME` and the party's ledger entry's `AMOUNT` (a debit, negative). The due date is the bill's `BILLCREDITPERIOD` in days. `ISCANCELLED` cancels. |
| Receipts | `VOUCHER` of a receipt type | The party's entry, in `ALLLEDGERENTRIES.LIST` when there is no party ledger name. It settles the bills its `Agst Ref` allocations name; On Account stays on account. |

- **Links:** records are linked by `GUID` and keep their Tally name (`erp_links.external_name`). A ledger renamed in Tally keeps its account, and vouchers find their party by its new name.
- **Duplicates:** voucher numbers restart each year when a company numbers that way, so two invoices of the same number are listed as `duplicate_code`, never merged. Companies can avoid this with a year in the prefix (`SI/25-26/…`).

**To confirm on a real export:**

- where the customer's release keeps the GST rate: on the item, its stock group, or the newer HSN details;
- `BILLCREDITPERIOD` written as a date rather than days;
- the aliases the customer actually uses for codes;
- whether Tally matches a voucher imported again with the same `REMOTEID`;
- that `VOUCHERNUMBER` is kept when the Sales Order type numbers automatically;
- that quantities written without their unit take the stock item's base unit.

## Sales orders

An admin presses Make the file in Settings › ERP. The worker writes every waiting accepted order, up to 500 a file, as a `Sales Order` voucher (the type the mappings name):

- `DATE`, `VOUCHERNUMBER` and `REFERENCE` (our order number), `REMOTEID` (our order's ID);
- `PARTYLEDGERNAME`, and the party's ledger entry for the total, a debit;
- one `ALLINVENTORYENTRIES.LIST` a line, for the accepted lines and their free goods: `STOCKITEMNAME`, `RATE` per base unit before tax, `AMOUNT`, and `ACTUALQTY`/`BILLEDQTY` in the base unit, written without the unit, so Tally takes the item's own.

Then:

- **Saving:** the file is kept 7 days. Save gives a five-minute link, and every download is audited. The admin imports it with Import › Transactions.
- **Once each:** an order goes in one file. Make again puts an earlier file's orders in a new one, for an import that went wrong.
- **Waiting:** an order whose customer or an item came from no upload waits as `not_in_books` until a file brings them.
- **Confirmed:** a later Day Book holding a sales order whose `REFERENCE` is our number marks the order as in the books.

A sales order posts no sale in Tally until it is converted there.

## What stays as the portal set it

A connection's rows carry only what the books know. The items import keeps an item's case unit, pack label, measure, HSN, MRP and active flag when a connection's row leaves them out (`ImportContext.keepMissing`), so orders in cases still work after every upload.
