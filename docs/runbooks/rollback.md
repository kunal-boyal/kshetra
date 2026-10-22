# Roll back

When a deploy goes wrong (spec 14.6, decision D67).

**Failed tasks roll back by themselves.** ECS's deployment circuit breaker returns a service to its last working revision when the new tasks keep failing their health checks. The Deploy workflow then fails at "services stable".

**Alarms after a deploy.** If the workflow fails while watching the alarms, the new version is running but something is wrong. Roll back to the previous commit: run the Deploy workflow from GitHub's Actions tab with that commit as `ref`. Its image is still in ECR, so nothing is built; the migration runs (and finds nothing to do) and the services move back.

The schema stays where it is: migrations are backward compatible (expand and contract), so the previous version runs against the newer schema. Never roll a migration back by hand.

**By hand**, with the GitHub environment's variables and an operator's AWS session:

```bash
IMAGE=<ECR_REPOSITORY_URL>:<previous commit> ECS_CLUSTER=… TASK_FAMILY_PREFIX=… \
  TASK_SUBNETS=… TASK_SECURITY_GROUP=… WATCH_MINUTES=5 infra/scripts/deploy-cell.sh
```

**The web portal** rolls back with the same workflow run, which publishes that commit's build.

Afterwards, write down what happened and why, and fix forward on `main`.
