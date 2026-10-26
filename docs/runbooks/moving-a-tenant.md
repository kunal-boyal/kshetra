# Moving a tenant between cells

Every tenant runs in one cell, and the directory records which (spec 9.5). Moving one, for example to a dedicated cell or off a full one, uses `pnpm tenant-move` (decision D95). Each step runs on the cell it names, with that cell's settings: its database, object store and signing key. The directory is shared, so the steps that only touch the directory can run on either cell.

## Before

- Both cells run the same release. The import refuses an archive whose last migration differs from the target's.
- Both cells share the environment's `COLUMN_KEY`; webhook secrets move sealed as they are. If they don't share it, rotate each webhook's secret after the move.
- Agree a window with the customer. During the move people can read but not change anything: phones keep their records in the outbox (`TENANT_MOVING`) and send them once the tenant lands.

## Steps

1. **On the target cell, once per cell:** `pnpm tenant-move register-cell` lists the target cell in the directory.
2. **Anywhere:** `pnpm tenant-move start --tenant <slug> --to <target cell>`.
   - The tenant's writes stop here.
   - Its scheduled work, such as the nightly jobs, waits.
   - The step is recorded in the platform audit.
3. **On the source cell:** `pnpm tenant-move export --tenant <slug> --out <slug>-move.zip`.
   - It refuses while any of the tenant's events are still being delivered; wait a minute and run it again.
   - The archive holds everything the target needs: every table (sync tombstones apart), secrets, stored answers, and every file with its derived copies.
   - The archive is signed by the source cell's key. Keep it as you would a database backup, and delete it once the move is done.
4. **On the source cell:** `pnpm archive public-key` prints the key that checks the archive's signature. Save it as `source.pem`.
5. **On the target cell:** `pnpm tenant-move import --file <slug>-move.zip --public-key source.pem`.
   - It checks the signature and every file's checksum, and that the target holds nothing of the tenant.
   - It imports every table in one transaction, each after the tables it refers to, with row versions taken afresh, and puts back the files.
   - It checks each table's count against the manifest. Any difference undoes the whole import.
6. **On the target cell:** `pnpm tenant-move finish --tenant <slug>`. The directory now sends the tenant's people to the target cell:
   - A request to the old cell answers `TENANT_MOVED`, and the apps refresh and follow.
   - Phones see a cursor from another cell and take a full copy.
   - Writes resume.
7. **Check:** sign in on the web and on a phone, open the live map and a report, and send a webhook test.
8. **On the source cell:** `pnpm tenant-move purge --tenant <slug> --confirm <slug>` removes the tenant's rows there.
   - Add `--files` only if the two cells don't share a bucket. With a shared bucket the files belong to the target too.
   - Old backups of the source cell keep the tenant's data until they age out; record when the last one expires.

## If something goes wrong

- **Before `finish`:** `pnpm tenant-move cancel --tenant <slug>` calls the move off, and the tenant writes again on the source. If the target holds a partial import, which can't happen as the import is one transaction, purge it there with `purge` after the cancel.
- **After `finish`:** the source still holds the tenant until you purge it. To go back, run the steps again in the other direction.
