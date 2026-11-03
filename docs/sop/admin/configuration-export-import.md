# Export and import the configuration

| | |
|---|---|
| **Who** | Export: Admin or Business head (`settings.manage`). Import: Admin or Business head, holding all of `settings.manage`, `terminology.manage`, `role.manage`, `designation.manage`, `territory.manage`, `form.manage`, `metric.manage` and `catalogue.manage` |
| **Where** | Web portal › **Settings** › **Data** › **Export and import**; also **Export configuration** on the Organisation page |
| **Module** | Core |
| **Related** | [Set up the organisation and its brand](organisation-and-branding.md), [Export all your organisation's data](data-export.md), [Define account types](account-types.md), [Forms](forms.md), [Metrics and the score](metrics-and-score.md) |

Your configuration as a file: terms, roles, designations, territory levels, fields, account types, forms, metrics, the score and your working rules. Prepare it in one environment, such as a test organisation, then bring it into another. An import shows what it would add and change before anything happens, and never removes anything.

## Before you start

- Agree with the vendor where the file comes from. An import changes many parts of your configuration at once.
- Export your current configuration first, as a copy to go back to.

## What a file holds

It has these parts: **Terms**, **Roles**, **Designations**, **Territory levels**, **People fields**, **Account types**, **Forms**, **Metrics**, **Score**, **Approval chains**, **People policies**, **Rules**, **Holiday calendars**, **Leave types**, **Expense policies**, **Attendance rule**, **Catalogue**, **Home layouts** and **Import column names**.

It leaves out your names, address, GSTIN, logo, brand colour and Maps key, which stay where they are. It holds no people, territories, accounts or records of work.

## Steps

### Export

1. Open **Settings** › **Data** › **Export and import**.
2. Under **Export**, select **Download the configuration**. Your browser saves a JSON file named with today's date, such as `configuration-2026-11-03.json`.

### Import

1. Under **Import**, select **Choose a file** and pick a configuration file. The page says **Checking the file…**
2. Read the summary: the file's name and how many entries it would add, change, keep as they are and leave the same.
3. If the page says **Fix these in the file, then choose it again. Nothing has been changed.**, read each problem listed, by its place in the file. Fix the file, or ask whoever prepared it, then choose it again.
4. Read **What the import does**: each entry's **Part**, **Key** and **Change**: **Add**, **Change**, **Kept** or **Same**. Tick **Show entries that are the same** to see those too.
5. Select **Import the file**. The page asks, for example, **Add 4 and change 2?** and says that forms and account types get a new version, and people see the changes at their next sync.
6. Select **Import the file** again. The page says **Imported: {added} added and {updated} changed.**

## What the system checks

- The file must be a configuration file in the templates' format, and every reference in it must resolve, as when you change each part by hand.
- An import adds and updates; it never removes anything.
- Some entries are **Kept** as they are here, such as the role you hold and the Admin role. The page says so when it happens.
- Keys never change, a field keeps its type, and a metric keeps its unit, as on the pages that edit them.
- A file exported before November 2026 may list the permissions `policy.manage` and `notification_template.manage`, or a chain for locking targets, which the product has since taken out (D137). The import reads the file as if they weren't there, with no problem shown.
- Forms and account types get a new version; phones get them at their next sync.
- **Import the file** is unavailable when the file would change nothing.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This file isn’t a configuration file. Export one and try again. | The file isn't JSON. | Choose a file exported from **Export and import**. |
| Fix these in the file, then choose it again. Nothing has been changed. | The file has problems, listed by place, in English from the server. | Fix each one and choose the file again. |
| Everything in the file is already here. | Nothing to add or change. | Nothing to do. |
| There is no **Import** section on the page. | Your role lacks one of the permissions an import needs. | Ask an admin who holds them all. |

## Waiting on the owner

- Problems the server describes come in English only (D42).
