# Restore drills

Every quarter, the database restore is rehearsed against staging (spec 14.6, decision D98). The drill never touches the cell's own database or services.

## Running one

Signed in to the staging account (`AWS_PROFILE`, `AWS_REGION=ap-south-1`), with `aws` and `jq`:

```bash
infra/scripts/restore-drill.sh --environment staging
```

The script:

1. Notes the database's latest restorable moment, and how far behind now it is. That is the most a real restore would lose (the target is 5 minutes).
2. Restores to that moment as a new instance, `<cell>-drill-<time>`, in the cell's subnets, security groups and parameter group, and waits until it is available.
3. Runs the image's restore check (`node dist/restore-check.mjs`) as a one-off task in the cell's network with the cell's secret, pointed at the copy. The check reports the migrations applied, how many tenants and people, and the newest write.
4. Deletes the copy, unless `--keep` is given.
5. Prints a line for the table below, and fails if the check failed or a target was missed (5 minutes of data, 2 hours in all).

The restore's own steps, for a real one, are in [database-restore.md](database-restore.md).

## Drills

| Date | Cell | Data behind (min) | Restore (min) | In all (min) | Result |
|---|---|---|---|---|---|
