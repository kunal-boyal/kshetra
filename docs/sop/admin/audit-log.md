# Read the audit log

| | |
|---|---|
| **Who** | Admin or Business head (`audit.view`); exporting it also needs `export.create` |
| **Where** | Web portal › **Settings** › **Data** › **Audit log**; the same log is under **Settings** › **People and access** › **Security and data** |
| **Module** | Core |
| **Related** | [Approve or end vendor support access](vendor-support.md), [Add and look after people](people.md), [Rules](rules.md) |

The audit log records every change made in your organisation: who made it, when, from where, and what it was before and after. Use it to answer "who changed this?", to check what vendor support did, and for your auditors.

## Before you start

- Entries are kept for as many years as **Settings** › **Organisation** › **Rules** says; older ones are removed ([Rules](rules.md)).

## Steps

1. Open **Settings** › **Data** › **Audit log**.
2. Under **Filters**, choose:
   - **Month**: one month at a time, this month to start.
   - **Action**: **Any action**, or one action by its code, such as `user.updated` or `settings.updated`.
   - **Who acted**: **Anyone**, or **A person**, **Vendor staff**, **The system**, **An API client** or **The ERP connection**.
   - **One person**: **Everyone**, or a person, to see what they did.
3. Read **Entries**, newest first: **When**, **Who**, **Action**, **About** (what was changed), **From** (the address it came from) and **Changes**.
4. Select **Before and after** in a row to see the values **Before** and **After** the change.
5. More entries load as you page on.

### Export it

1. Set the filters as you want them in the file.
2. Select **Export as CSV** or **Export as Excel**. The page says **Preparing your file. Find it in Reports, under Your downloads.**
3. Select **Open Reports** and download the file from **Your downloads** when it is ready (the message says "Exports", but the list is headed **Your downloads**). Files are kept 7 days.

### Other places the log shows

- A person's page has **History**: what was changed about them ([Add and look after people](people.md)).
- **Vendor support** shows, under each open grant, **What vendor support did** ([Approve or end vendor support access](vendor-support.md)).

## What the system checks

- Every change writes its entry in the same transaction as the change, so a change without an entry can't happen.
- Entries can't be edited or deleted by anyone; only the retention rule removes old ones.
- Changes made by vendor staff are marked **Vendor staff** with the grant they were made under; changes by the ERP connection and API clients are marked as theirs.
- Values are recorded as they were, except secrets and some personal figures, such as a salary, which are never written into an entry.
- Every export is itself recorded.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Nothing matches in this month. | No entry fits the filters in that month. | Choose another month, or clear **Action**, **Who acted** or **One person**. |
| You don't have access to this. | Your role lacks `audit.view`, or `export.create` for exporting. | Ask an admin. |
