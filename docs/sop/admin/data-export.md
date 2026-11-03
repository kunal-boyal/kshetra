# Export all your organisation's data

| | |
|---|---|
| **Who** | Admin or Business head (`settings.manage`) |
| **Where** | Web portal › **Settings** › **Data** › **Data export** |
| **Module** | Core |
| **Related** | [Export and import the configuration](configuration-export-import.md), [Answer a personal data request](data-requests.md), [Read the audit log](audit-log.md) |

The data export is everything your organisation holds, every table and every file, as one signed ZIP archive. Take one whenever you want your own copy, before you leave the product, or when an auditor asks. For one person's data, use a data request instead ([Answer a personal data request](data-requests.md)).

## Before you start

- The archive can be large: it holds every photo and file as well as every record. Download it where you have room and a steady connection.
- Keep the archive safe: it holds personal data about everyone in your organisation.

## Steps

1. Open **Settings** › **Data** › **Data export**.
2. Select **Prepare an export**. The page says **Preparing your export. This page updates when it is ready.** You can leave the page; preparing a large export takes a while.
3. Under **Exports**, the new row shows **Waiting**, then **Preparing**, then **Ready**, with **Kept until {time}**.
4. When it is ready, the row shows its **Contents** (how many tables, rows and files) and **Size**.
5. Select **Download** on its row. Each download asks for a fresh link, so each is recorded in the audit log.
6. Note the **Archive SHA-256** shown under **Download**: it lets you check the file arrived whole.

### Check an archive was not changed

Under **Checking an archive**, the page shows the **Key ID** and **Public key** that sign your archives. Inside the archive, `manifest.json` lists every file with its SHA-256, and `manifest.sig` is the Ed25519 signature of `manifest.json`. Check the signature with the public key, then each file's checksum. Give the key and these steps to whoever checks it, such as your auditor or the vendor.

## What the system checks

- One export at a time: **Prepare an export** stays unavailable while one is being prepared.
- An export is kept for seven days, then removed (**Removed**).
- The archive holds every table of yours, as JSON lines, every file, and a signed manifest. Secrets such as connection passwords are left out.
- Asking for an export and every download are in the audit log.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Failed**, with a reason under it | The export couldn't be completed. | Select **Prepare an export** again. If it fails again, tell the vendor. |
| **Removed** | The seven days have passed. | Prepare a new export. |
| No exports yet. | Nobody has asked for one. | Select **Prepare an export**. |
| You don't have access to this. | Your role lacks `settings.manage`. | Ask an admin. |
