#!/usr/bin/env bash
# Rolls one cell onto an image (spec 14.3, decision D67): new task definition revisions with the
# image, the migration (which must exit 0), then the API, worker and scheduler, then a watch of
# the cell's alarms. The deploy workflow runs it; so can an operator, for a rollback, with the
# same variables (docs/runbooks/rollback.md).
#
#   IMAGE                 repository:tag to run
#   ECS_CLUSTER           the cell's cluster
#   TASK_FAMILY_PREFIX    such as thelamp-staging-cell1; families are <prefix>-api and so on
#   TASK_SUBNETS          comma-separated private subnets for the migration task
#   TASK_SECURITY_GROUP   the tasks' security group
#   WATCH_MINUTES         how long the alarms must stay quiet afterwards (default 15)
set -euo pipefail

: "${IMAGE:?}" "${ECS_CLUSTER:?}" "${TASK_FAMILY_PREFIX:?}" "${TASK_SUBNETS:?}" "${TASK_SECURITY_GROUP:?}"
WATCH_MINUTES="${WATCH_MINUTES:-15}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The family's latest revision, with the new image: its settings come from Terraform.
register() {
  local family="$1"
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json |
    jq --arg image "$IMAGE" '
      .containerDefinitions[0].image = $image
      | {family, taskRoleArn, executionRoleArn, networkMode, containerDefinitions,
         requiresCompatibilities, cpu, memory, runtimePlatform}' >"$work/$family.json"
  aws ecs register-task-definition --cli-input-json "file://$work/$family.json" \
    --query taskDefinition.taskDefinitionArn --output text
}

# Each process's new revision, as revision_<process> (bash 3 has no maps, and macOS ships it).
revision() { local name="revision_$1"; echo "${!name}"; }

echo "Registering revisions with $IMAGE"
for process in migrate bootstrap api worker scheduler; do
  printf -v "revision_$process" '%s' "$(register "$TASK_FAMILY_PREFIX-$process")"
  echo "  $process: $(revision "$process" | sed 's|.*/||')"
done

echo "Migrating"
network="awsvpcConfiguration={subnets=[$TASK_SUBNETS],securityGroups=[$TASK_SECURITY_GROUP],assignPublicIp=DISABLED}"
task="$(aws ecs run-task --cluster "$ECS_CLUSTER" --launch-type FARGATE \
  --task-definition "$(revision migrate)" --network-configuration "$network" \
  --started-by deploy --query 'tasks[0].taskArn' --output text)"
aws ecs wait tasks-stopped --cluster "$ECS_CLUSTER" --tasks "$task"
code="$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
if [[ "$code" != "0" ]]; then
  echo "The migration exited with $code; nothing else changed. See docs/runbooks/failed-migration.md." >&2
  exit 1
fi

echo "Updating services"
for process in api worker scheduler; do
  aws ecs update-service --cluster "$ECS_CLUSTER" --service "$process" \
    --task-definition "$(revision "$process")" --query service.serviceName --output text >/dev/null
done
# The circuit breaker rolls a service back by itself if its new tasks keep failing.
aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services api worker scheduler

echo "Watching the cell's alarms for $WATCH_MINUTES minutes"
for ((minute = 1; minute <= WATCH_MINUTES; minute++)); do
  firing="$(aws cloudwatch describe-alarms --alarm-name-prefix "$TASK_FAMILY_PREFIX-" \
    --state-value ALARM --query 'MetricAlarms[].AlarmName' --output text)"
  if [[ -n "$firing" ]]; then
    echo "Alarms firing after the deploy: $firing. Roll back with docs/runbooks/rollback.md." >&2
    exit 1
  fi
  [[ "$minute" -lt "$WATCH_MINUTES" ]] && sleep 60
done
echo "Deployed $IMAGE to $ECS_CLUSTER"
