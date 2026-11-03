# Connect your books: Zoho Books, SAP Business One or Tally

| | |
|---|---|
| **Who** | Admin (`erp.manage`) |
| **Where** | Web portal › **Settings** › **Developers** › **ERP** |
| **Module** | **Integrations** |
| **Related** | [Keep the catalogue and price lists](catalogue-and-price-lists.md), [Connect your systems with API clients and webhooks](api-clients-and-webhooks.md), [Set the organisation's rules](rules.md) |

Connect the system your books are kept in. Customers, items and prices, invoices and payments come in from it, and accepted orders can go out to it. Zoho Books and SAP Business One are read every hour; Tally runs on your own computer, so you upload its exports and import a file of orders into it.

## Before you start

- The **Integrations** module is on. While it is off, or the organisation is read only, nothing runs; connections are kept.
- In the default templates only the Admin role holds `erp.manage`. It also asks for an authenticator code at sign-in on the web.
- The account type customers become, the territories they belong to and the price lists their prices go into exist here first.
- Records come in as rows of the existing imports (accounts, items, prices, invoices, receipts), checked the same way. A record already here with the same code is updated, and one that hasn't changed isn't written again.
- **Zoho Books:** you can sign in to Zoho as someone who may agree to the connection, and you know which Zoho data centre you use.
- **SAP Business One:** your SAP partner has published the Service Layer on HTTPS, port 443, with a valid certificate, and your SAP admin has made a user for this connection, able to read customers, items, price lists, invoices and payments, and to add orders.
- **Tally:** TallyPrime, and someone who can export from it.

## Steps

### Connect Zoho Books

1. Open **Settings** › **Developers** › **ERP**. In the **Zoho Books** card, choose **Your Zoho data centre** (for a Zoho organisation in India, choose **India**).
2. Select **Connect Zoho Books**. The browser goes to Zoho; sign in and agree there. This app never sees your Zoho password.
3. Zoho sends you back to **Connecting Zoho Books** ("Finishing the connection…"), then to **ERP**.
4. If your Zoho login holds several organisations, the card says **Choose the organisation**. Choose the **Organisation to connect** and select **Use this organisation**.
5. The card shows **Connected**, the **Organisation in Zoho**, **Your Zoho data centre**, when and by whom it was **Connected**, and the **Last run**. Set the mappings below.

### Connect SAP Business One

6. In the **SAP Business One** card, fill in **Service Layer address** (for example `https://b1.yourcompany.in`, HTTPS on port 443 only), **Company database**, **SAP user** and **Password**.
7. Select **Connect SAP Business One**. The details are checked by signing in to SAP; the password is then kept sealed and never shown again.
8. To change them later, select **Change the details**, fill them in again, and select **Check and save the details**.

### Use Tally

9. In the **Tally** card, select **Use Tally**. There is nothing to reach.
10. Open **How to export from TallyPrime** for the steps:
    - Masters: Export › Masters, choose All Masters and the XML (Data Interchange) format.
    - Transactions: open the Day Book for a period, then Export in XML. Export a month at a time if a year comes to more than 20 MB.
11. Select **Upload a file from Tally** and choose the file: an XML export up to 20 MB. Upload the masters first. You see "The file is being read. Its run appears below when it finishes." **Company in Tally** is named by the first file you upload.

### Set what comes in, and where

12. Under **What comes in, and where**, tick what to read: **Customers, as accounts**, **Items and their prices**, **Invoices**, **Payments**.
13. Choose what **Customers become**: the account type Zoho's customers are. Each customer's number in the books becomes its code.
14. Territories:
    - Zoho and SAP: **Zoho field holding the territory code** (for SAP, a user field on business partners, such as `U_Territory`). Leave it empty to keep each account's territory here.
    - Tally: **Customer groups** (Tally groups whose ledgers are customers, separated by commas), and **Territories by group**, a **Group in Tally** and its **Territory** per row, added with **Add a group**. A ledger takes the nearest group listed above it.
    - All: **Territory for new customers**, used when a new customer's field or group gives none.
15. Prices:
    - Zoho: **Price list for item rates** (or **The default list**), and under **Zoho price books** a **Price book ID in Zoho** and the list it goes **Into the price list**, added with **Add a price book**. Only per-item sales price books can be read.
    - SAP: under **SAP price lists**, a **Price list number in SAP** and its price list, added with **Add a price list**.
    - Tally: under **Price levels**, a **Price level in Tally** and its price list, added with **Add a price level**.
16. **Units named differently**: only where the books' unit isn't the name of one of yours, for example pcs for piece. Fill in **Unit in Zoho** and **Your unit**, added with **Add a unit**.
17. Tax, for SAP and Tally: **SAP field holding the GST rate** (a user field on items, such as `U_GST`), and **GST rate when the field is empty** (Tally: **GST rate when Tally gives none**). An item with neither is left out and listed.
18. Zoho and SAP: **Days of invoices to read** (7 to 730). Zoho only: **Your Zoho plan’s daily calls** (Free is 1,000, Standard 2,000, Professional 5,000; a tenth is always left for you).
19. Tally: **Sales voucher types** and **Receipt voucher types** (each with every type under them, separated by commas), and the **Voucher type for orders** they go into Tally as.
20. Zoho and SAP: tick **Send accepted orders to Zoho Books** (or **to SAP Business One**): those the company supplies, once accepted, with their accepted lines. Each goes once.
21. Select **Save**. You see **Saved.**

### Run and check

22. Zoho and SAP read every hour. To read now, select **Sync now** under **Runs**. The run appears when it finishes.
23. **Runs** lists each run's **Started**, **Kind** (**Read**, **Orders out** or **File read**), **Result** (**Running**, **Done**, **Done, with problems** or **Failed**, with why it stopped), **Records** per kind (read, written, left out) and, for Zoho and SAP, **Calls**.
24. Under the runs, "The last run left out 3 records" lists each record and why, such as "Items, ABC-01: it has no SKU in Zoho." Fix it in the books; the next run picks it up.

### Send orders to Tally

25. In **Orders for Tally**, the card says how many accepted orders are waiting for a file. Select **Make the file**. You see "The file is being made. It appears in the runs below with Save."
26. In **Runs**, select **Save** beside the file, then in Tally use Import › Transactions.
27. If the import went wrong, select **Make again** beside that file to make it once more.

### Disconnect

28. Select **Disconnect**, then **Disconnect** again to confirm. Nothing more is read or sent until you connect it again. What came in stays, and the mappings are kept.

## What the system checks

- Only Zoho's own addresses are ever called, for the region chosen (BR-59, `zohoHostIssue()`). A SAP address must be HTTPS on port 443 to a public server (BR-60, `sapEndpointIssue()`).
- Every record goes through the same checks as its file import, as the connection. What each record became is remembered, so a record is never made twice.
- Zoho calls are paced under Zoho's limit a minute and stop before the day's limit, leaving a tenth for you (`callsLeft()`).
- SAP reads ask only for what changed since the last run, and sign in again once if SAP refuses.
- An order goes out only once accepted, with its accepted lines. It is looked for in the books by its number before it is made, so it is never sent twice. An order whose customer or an item isn't in the books yet waits, and is listed.
- A Tally file is refused if it isn't Tally's, declares entities, or is from another company than the one connected (BR-61, `checkTallyFile()`). Uploaded files expire with **Keep uploaded import files for** on [Set the organisation's rules](rules.md); order files are kept 7 days. A Tally order is confirmed when a later Day Book holds its sales order.
- If Zoho or SAP refuses the connection, the card says **Needs connecting again**, nothing is read or sent, and holders of `erp.manage` are notified.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This server isn't set up for Zoho Books yet. Ask your vendor to add its Zoho client. | The vendor hasn't given this server a Zoho client. | Ask the vendor. |
| Zoho didn't give access. Nothing was connected. | You declined at Zoho, or Zoho refused. | Select **Back to ERP** and connect again. |
| Zoho sent the browser back without what is needed. Start connecting again. | The return from Zoho was incomplete. | Connect again. |
| Zoho no longer accepts this connection… / SAP no longer accepts this user… | The agreement or the SAP user was withdrawn. | Connect again, or enter SAP's details again; mappings are kept. |
| Use HTTPS on port 443; ask your SAP partner to publish the Service Layer there | The SAP address isn't on 443. | Ask your SAP partner. |
| This isn't a file exported from Tally. Export it again in XML. | The upload isn't a Tally XML export. | Export again as the how-to says. |
| This file is from another company in Tally than the one connected. | The file names a different Tally company. | Upload the connected company's file. |
| Done, with problems, and a list of records left out | Some records couldn't come in, such as "its customer isn't here yet" or "choose what customers become first". | Fix each in the books or in the mappings; the next run picks them up. |
| … stopped at the day's calls | Zoho's daily limit was reached. | Wait for the next day, or raise **Your Zoho plan’s daily calls** if your plan allows more. |

## Waiting on the owner

- None of the three connectors has had a pass against a real system yet: Zoho Books needs a test company and Kunal's Zoho client ID and secret on the server; SAP Business One needs a test system with its Service Layer on HTTPS 443; Tally needs a real export to check against. Don't connect a customer's books before that pass.
