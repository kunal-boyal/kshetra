# Import and export

| | |
|---|---|
| **Who** | Back office, Business head, Admin (`import.run`, plus the permission of what you import; `export.create` to export) |
| **Where** | Web portal › **Imports**; **Reports** › **Your downloads** |
| **Module** | Core; each kind of record needs its own module |
| **Related** | [Keep receivables and statements](receivables-and-statements.md), [Keep distributors' stock](stock.md), [Payroll](payroll.md), [Reports](reports.md) |

An import adds or updates many records at once from a spreadsheet. Every row is checked first, and nothing is written unless the whole file is right. An export is a report saved as a file, prepared in the background and kept for 7 days.

## Before you start

- The **Imports** page offers people, territories, each account type, catalogue items, targets and account plans, each to those who hold the permission that owns it. Back office usually imports none of these; an admin does ([Import records from a spreadsheet](../admin/imports.md)).
- Statement entries, invoices, receipts and credit notes, stock movements and stock levels, sell-through and forecasts aren't on the page yet. The server takes them as file imports and through the bulk API, so today they arrive through an [ERP connection](../admin/erp-connections.md) or an integrator's API client ([API clients and webhooks](../admin/api-clients-and-webhooks.md)). Balances and ageing, monthly gross and salary structures have a file import on the server but neither a page nor a bulk route: enter them on their own screens.
- A file is .xlsx or .csv, up to 20 MB and 20,000 rows, and your plan may set a lower row limit. The headings can sit under a title.
- Names and codes in the file must match the product's: account codes, item codes, employee codes.

## Steps

### Import a file

1. Open **Imports** in the left rail. Under **New import**, choose **What to import**.
2. Choose **Download an example** for an Excel file of what you chose: fill its first sheet; the second shows example rows and the third says what each column holds.
3. Under **File**, choose **Choose a file**, then **Upload and read**.
4. Under **Columns**, if the workbook has more than one sheet, choose the **Sheet**. The page says which row holds the headings. For each column, choose what it holds, or **Leave out**. Each field may be chosen once.
5. Optionally, give **Save these choices as** a name: the next file with the same headings is offered the same choices.
6. Choose **Check the file**. Nothing is written yet.
7. The check shows **Ready** (new and updated rows), **Problems** and **Skipped** (empty rows). **Problems** lists each **Row**, **Column**, **Value in the file** and **Problem**; **Preview** shows the first rows as they will be imported.
8. With problems, nothing can be imported: fix the file and choose **Upload a fixed file**, or **Change columns**.
9. With none, choose **Import … rows**, then confirm **Import … rows now?**. Every row is checked again and written together; if anything changed since the check, nothing is written.
10. It says **Imported: … added, … changed.** **Earlier imports** lists every import with its **File**, **What**, **Status**, **Rows**, **Result** and **Started**.

### Systems that send records by themselves

Integrators with an API client send the same records as JSON to the bulk API (`/v1/bulk/…`), through the same checks, all or nothing; this needs the Integrations module and is set up by an admin in Settings › **API clients**.

### Download an export

1. Start an export where you read the figures: **Download as CSV**, **Download as Excel** or **Export every report** on **Reports**; **Export register** on **Attendance**; **Export for payroll** on **Expenses**; **Export the summary** on **Payroll**.
2. The file is prepared in the background. **Reports** opens and says **Your file is being prepared. It shows under Your downloads when ready, and you will be told.**
3. Under **Your downloads**, choose **Download …**. Each file shows **Kept until …**.

## What the system checks

- Every row is checked before anything is written, and checked again at the moment of writing; a file is written whole or not at all.
- A person's name in a file, such as who someone reports to, matches only when one person clearly fits: an exact name, then initials, then the one clearly closest name. Anything else fails the row rather than guess (BR-42, `matchName`).
- Records are added and updated, never removed, by an import.
- An export holds what you may see at the moment it runs, up to your plan's row limit. Only you can download your exports, and every export and download is recorded in the audit log. Text that would start a spreadsheet formula is made safe.
- Uploaded files are kept for your organisation's **Keep uploaded import files for** setting; exports for 7 days.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some rows have errors. Fix them, then upload the file again. | The check found problems. Nothing was written. | Fix the rows listed under **Problems**, then **Upload a fixed file**. |
| Choose a column for: …. | A required field has no column. | Choose its column, or add it to the file. |
| Another column fills this too. Choose each field once. | Two columns were chosen for one field. | Choose **Leave out** for one. |
| The file has no rows under its headings. | The sheet chosen is empty. | Choose the right **Sheet**, or fill the file. |
| The import stopped, and nothing was imported. … | The file couldn't be read, or something failed while writing. | Choose **Upload a file again**. |
| The import stopped, and nothing was imported. The file has more than … rows. Split it, and import each part. | The file has more rows than your plan allows. | Split the file and import each part. |
| Nothing downloaded in the last 7 days. | No exports kept. | Start one again. |
