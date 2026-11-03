# Reports

| | |
|---|---|
| **Who** | Back office, Manager, Business head, Admin, Viewer (`report.view`; `export.create` to download; `report.schedule`, held by Manager, Business head and Admin, to schedule) |
| **Where** | Web portal › **Reports** |
| **Module** | Core; some reports belong to a module (below); scheduled reports need Advanced analytics |
| **Related** | [Import and export](imports-and-exports.md), [Follow the team's performance](../manager/team-performance.md) |

Every report reads one month, narrowed to a team, a territory or one person, and shows only what your role reaches. Read it on screen, download it as a file, download every report in one workbook, or have it emailed every week or month.

## Before you start

- You see only the reports your role and your organisation's modules allow:

| Report | Needs |
|---|---|
| **Activity log** (the tenant's word for activities), **Visit compliance**, **Account coverage and frequency**, **Location summary**, **Targets against achievement**, **Sell-through by item**, **Forecast accuracy** | `report.view` |
| **Attendance register**, **Leave register** | Leave and attendance |
| **Expense register** | Expenses |
| **Order register**, **Scheme summary** | Orders, `order.view` |
| **Account statement**, **Outstanding**, **Collections** | Account finance, `finance.view` (`collection.view` for Collections) |
| **Payroll summary** | Payroll inputs, `payroll.manage` |
| **Pay register** | Statutory payroll, `payroll.run` |
| **Stock on hand**, **Stock ledger** | Inventory, `stock.view` |
| **GPS audit trail** | `trail.view`; one person at a time |
| **Audit log** | `audit.view` |

## Steps

### Read a report

1. Open **Reports** in the left rail. Choose the **Report**.
2. Choose the **Month** with **Previous month** and **Next month**.
3. Under **Filters**, narrow by **Team of**, **Person**, **Territory**, **Account type** or **Form**; **All** leaves a filter open. **Filters set** shows those in use; **Clear …** removes one. Choose a **Form** to see each of its fields as a column.
4. The table shows the report for the month, in your language and your organisation's words.

### Download it

1. Choose **Download as CSV** or **Download as Excel**. The file holds exactly what the screen shows.
2. It is prepared in the background; it appears under **Your downloads** when ready, and you are told. Choose **Download …**. Files are kept 7 days (**Kept until …**).

### Download every report at once

1. Choose the month and filters.
2. Choose **Export every report**: one Excel file with a sheet for each report you can see, for this month and the people chosen.

### Schedule a report

Manager, Business head, Admin (`report.schedule`), with Advanced analytics on.

1. Open the report and choose **Schedule this report**.
2. Choose the **File**, **How often** (**Every week**: the month so far, and on the 1st last month complete; **Every month**: on the 1st, last month complete), the **Day** for weekly sends, the **Time** and the **Language**.
3. Under **Send to**, **Add a person** for each recipient. Each gets it as they may see it, at the time it goes; the email links to the file, which waits 7 days, and nothing from the report goes in the email.
4. Choose **Schedule it**. It says **Scheduled. Each person gets it by email when it goes.**
5. The **Scheduled** tab lists **Your schedules** (**Running**, **Next on …**, **To …**): **Change**, **Pause** or **Resume**, **Show sends** for **Latest sends** and **Each person’s file**, and **End**, which asks **End this schedule? Nothing more goes out; files already sent stay for their 7 days.** **Sent to you** lists schedules others made for you; **Stop sending me this** takes you off.

## What the system checks

- Every report is narrowed to your scope and filters, for one month on your organisation's clock; headings and coded values come in the chosen language with your organisation's terms.
- **GPS audit trail** reads one person's points at a time, and only for the days whose raw points are still kept.
- An export holds what you may see when it runs, within your plan's row limit; only you download it, and each request and download is recorded.
- A schedule sends once for each send moment, on your organisation's clock, even after a pause in the service; recipients must be people you reach who may export (BR-52, `sendDue()`, `scheduledPeriod()`).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This took too long to read. Narrow it down, or export it instead. | The month is too large to read on screen. | Narrow the filters, or download it. |
| Choose a person | The GPS audit trail reads one person at a time. | Choose them under **Person**. |
| Nothing to show | Nothing matches the filters for this month. | Change the month or filters. |
| Choose at least one person. | A schedule has no recipient. | **Add a person**. |
| This feature is switched off for your organisation. | The report's module is off. | Ask your admin. |

## Waiting on the owner

- Scheduled reports go by email; email in production needs Amazon SES out of its sandbox.
