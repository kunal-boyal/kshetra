# Moving a tenant between cells

Every tenant runs in one cell; the directory records which (spec 9.5). Until a second cell exists, every tenant is in `cell1` and nothing moves. The tooling to move a tenant arrives with the platform console (phase 3); until then the move is planned work, not routine:

1. Announce a maintenance window; set the tenant read-only (`TENANT_READ_ONLY`), so phones keep their records in the outbox.
2. Copy the tenant's rows from every `cell` table, by `tenant_id`, and its media objects, to the new cell.
3. Point the directory's tenant row at the new cell; people's next refresh reaches it.
4. Raise nothing else: sync cursors carry the cell, so phones take a full copy from the new one.
5. Reopen the tenant; check sign-in, sync and the live map; delete the tenant's rows from the old cell after the retention of the old cell's backups.
