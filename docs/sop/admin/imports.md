# Import records from a spreadsheet

| | |
|---|---|
| **Who** | Admin or Business head (`import.run`, with the permission over what is imported, listed below); Back office holds `import.run` too |
| **Where** | Web portal › **Data** › **Imports** |
| **Module** | Core |
| **Related** | [Add and look after people](people.md), [Build the territory tree](territories.md), [Add accounts and approve proposals](accounts.md), [Catalogue and price lists](catalogue-and-price-lists.md), [Keep extra details about people](people-fields.md) |

An import adds or updates many records at once from an Excel or CSV file. Every row is checked first, and nothing is written unless the whole file is right. Import in this order: territories, then people (managers come from the same file or earlier ones), then accounts.

## Before you start

- Set up what the rows refer to: territory levels before territories; designations, roles and people fields before people; account types and territories before accounts ([Build the territory tree](territories.md), [Set up roles and designations](roles-and-designations.md), [Define account types](account-types.md)).
- Your file is an `.xlsx` or `.csv` of up to 20 MB and 20,000 rows. Headings can sit under a title.

### What the Imports page offers

| **What to import** | Needs, besides `import.run` |
|---|---|
| **People** | `user.manage` |
| **Territories** | `territory.manage` |
| Each account type that is in use, by its name, such as Retailers | `account.import` |
| **Catalogue items** | `catalogue.manage` |
| **Targets** (the tenant's word for targets) | `target.edit` |
| **Account plans** (the tenant's word for account) | `account_plan.manage` |

The list shows only what your role may import.

## Steps

### Start an import

1. Open **Imports** in the rail, under **Data**. Or select **Import from a file** on **People**, **Import from a spreadsheet** on **Territories**, or **Import** on **Accounts**.
2. Under **New import**, choose **What to import**.
3. If you don't have a file yet, select **Download an example**. It is an Excel file for what you chose: fill its first sheet; the second shows example rows, and the third says what each column holds.
4. Select **Choose a file** and pick your file. Its name shows beside the button.
5. Select **Upload and read**. The import's page opens and shows five steps: **What to import**, **Upload**, **Match columns**, **Check**, **Import**. While the file is read, the page says **Reading the file. This page updates by itself.**

### Match the columns

6. Under **Columns**, each heading of your file has a list. Choose the field each column fills, or **Leave out**. Fields marked `*` are required; until each has a column the page says **Choose a column for: {fields}.**
7. If the workbook has more than one sheet, choose it in **Sheet**.
8. To reuse these choices for the next file with the same headings, give them a name in **Save these choices as**.
9. Select **Check the file**. The page says **Checking every row. This page updates by itself.**

### Read the check

10. Three tiles sum it up: **Ready** (new and updated rows), **Problems** (and in how many rows) and **Skipped** (empty rows, left out).
11. If there are problems, the page says **Nothing has been imported. Fix these rows in the file and upload it again, or change the columns.** The **Problems** table lists each one's **Row**, **Column**, **Value in the file** and **Problem**.
12. **Preview** shows the first rows as they will be imported.
13. To fix problems: select **Change columns** if a column was matched wrongly, or correct the file and select **Upload a fixed file** to start again.

### Import

14. When there are no problems, select **Import {count} rows**, for example **Import 240 rows**.
15. Confirm with **Import {count} rows** again. Every row is checked again and written together; if anything changed since the check, nothing is written.
16. The page says **Imported: {created} added, {updated} changed.** You also get an **Import done** notification. Then open what you imported: **Open people**, **Open territories**, **Open accounts** (in your word for accounts), **Open the catalogue** for items, **Open targets** or **Open holiday calendars**; after anything else, **Back to imports**.

### See earlier imports

**Earlier imports** on the Imports page lists every file, newest first, with **What**, **Status**, **Rows**, **Result** and **Started**. Select a file's name to open it.

## What the system checks

- All or nothing: one bad row stops the whole file (`ImportRefused`).
- Each row passes the same checks as adding it by hand: unique codes, existing designations, roles, territories and managers, a valid mobile number not active in another organisation, seats left on your plan, and no role beyond your own access.
- Names in the file are matched to records carefully: a name close to two records is never guessed (BR-42, `matchName`).
- A row that matches an existing record by its code updates it; others are added.
- A file over your plan's row limit is refused.
- The import is in the audit log.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Choose a file to import. | You selected **Upload and read** without a file. | Select **Choose a file** first. |
| Another column fills this too. Choose each field once. | Two columns are matched to one field. | Change one of them, or **Leave out**. |
| **Has problems** status, with **Problems** listed | Rows fail the checks. The **Problem** column says why, in English from the server. | Fix the rows in the file and select **Upload a fixed file**. |
| The import stopped, and nothing was imported. … | The file couldn't be read or written; the reason follows. You also get an **Import failed** notification. | Select **Upload a file again** and try once more; if it fails again, send the file to the vendor. |
| Some rows have errors. Fix them, then upload the file again. | Something changed between the check and the import. | Upload the file again. |
| The type you want isn't in **What to import** | Your role lacks its permission, or the type is switched off. | Ask an admin. |

## Waiting on the owner

- Problems found in rows are described in English only (D42).

## Not offered on this page yet

The server also takes imports of balances and ageing, statement entries, invoices, receipts and credit notes, holidays, external metric values, monthly gross, salary structures, sell-through by item, forecasts, stock movements and stock levels, but the Imports page doesn't offer them yet. Some reach the product another way: statement entries, invoices, receipts, sell-through, stock movements and levels, forecasts and external metric values through the public API's bulk routes ([API clients and webhooks](api-clients-and-webhooks.md)), and invoices and receipts through an ERP connection ([ERP connections](erp-connections.md)). Holidays are added on their calendar ([Calendars and holidays](calendars-and-holidays.md)).
