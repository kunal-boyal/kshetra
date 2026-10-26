# Point-in-time database restore

RDS keeps 14 days of point-in-time recovery for each cell's database (spec 14.6, decision D67). A restore makes a new database instance; the old one stays until it is deleted by hand.

1. **Decide the moment** to restore to, in UTC, just before the damage. Note it in the incident's record ([incident response](incident-response.md)).
2. **Stop writes:** scale the cell's `api`, `worker` and `scheduler` services to 0 in ECS, so nothing writes to the old database while you work.
3. **Restore** to a new instance in the same subnet group, security group and parameter group:
   ```bash
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier thelamp-<environment>-cell1 \
     --target-db-instance-identifier thelamp-<environment>-cell1-restored \
     --restore-time <UTC time> \
     --db-subnet-group-name thelamp-<environment>-cell1 \
     --vpc-security-group-ids <database security group> \
     --db-parameter-group-name thelamp-<environment>-cell1-postgres18
   ```
4. **Point the cell at it:** in the cell's secret, change the host in `DATABASE_URL`, `DIRECTORY_DATABASE_URL`, `DATABASE_MIGRATOR_URL` and `DATABASE_BOOTSTRAP_URL`. Then, in Terraform, import the restored instance in place of the old one (or rename it to the old identifier after the old one is renamed aside), so later applies keep managing it.
5. **Raise `SYNC_EPOCH`** in the environment's settings: every phone's sync cursor is refused with `SYNC_RESET`, and each phone takes a full copy again, so none keeps rows the restore removed (decision D40).
6. **Deploy** the current commit, which starts the services on the new settings, then check `/ready` and a sign-in.
7. Record the timings: the spec's targets are 5 minutes of data at most (RPO) and 2 hours to recover (RTO). The quarterly drill rehearses steps 1 and 3 against staging with `infra/scripts/restore-drill.sh`, and checks the copy without touching the cell ([restore-drills.md](restore-drills.md)).

Data that phones captured after the restore point and still hold in their outbox upload again, as every write is idempotent by its own ID.
