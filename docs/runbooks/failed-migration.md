# Failed migration

The Deploy workflow runs the migration before touching any service; when it exits with anything but 0, the deploy stops and the cell keeps running the previous version (decision D67).

1. Read the migration task's log in CloudWatch: `/kshetra-<environment>-cell1/migrate`.
2. Drizzle runs each migration file in a transaction, so a failed file leaves nothing half-applied. Check which migrations are recorded: `select * from drizzle.__drizzle_migrations order by created_at desc limit 5;` (connect as the migrator from a one-off task, as the database is private).
3. Fix the migration on a branch and merge it; the next deploy runs it. Never edit a migration that has run anywhere: add a new one.
4. A migration that runs too long, or waits on a lock, is the wrong shape: use `CREATE INDEX CONCURRENTLY` (in a migration of its own, outside a transaction) and batched backfills in a job (CLAUDE.md, Migrations).
