#!/usr/bin/env bash
# The quarterly restore drill (spec 14.6, decision D98). It restores a cell's database to its latest
# restorable moment as a separate instance, checks the copy from inside the cell with the image's
# restore check (`node dist/restore-check.mjs`), times each part against the targets (5 minutes of
# data at most, 2 hours to recover), and deletes the copy. The cell's own database and services
# are never touched. docs/runbooks/database-restore.md says how a real restore goes on from here.
#
#   infra/scripts/restore-drill.sh [--environment staging|production] [--cell cell1] [--keep]
#
# Signed in to the environment's AWS account (AWS_PROFILE, AWS_REGION). Needs aws and jq.
set -euo pipefail

environment=staging
cell=cell1
keep=false
while (($#)); do
  case "$1" in
    --environment) environment="$2"; shift 2 ;;
    --cell) cell="$2"; shift 2 ;;
    --keep) keep=true; shift ;;
    *) echo "Usage: $0 [--environment staging|production] [--cell cell1] [--keep]" >&2; exit 2 ;;
  esac
done

root="$(cd "$(dirname "$0")/../.." && pwd)"
prefix="$(jq -r .slug "$root/product.json")-$environment-$cell"
drill="$prefix-drill-$(date -u +%Y%m%d%H%M)"
now() { date -u +%s; }
minutes() { awk -v s="$1" 'BEGIN { printf "%.1f", s / 60 }'; }

echo "Restore drill for $prefix"
source_json="$(aws rds describe-db-instances --db-instance-identifier "$prefix" --query 'DBInstances[0]' --output json)"
latest="$(jq -r .LatestRestorableTime <<<"$source_json")"
# How far behind the latest restorable moment is: what a restore now would lose at most. jq reads
# the time the same way on macOS and Linux, which `date` does not.
lag=$(($(now) - $(jq -r '.LatestRestorableTime | sub("\\.[0-9]+"; "") | sub("(\\+00:00|Z)$"; "Z") | fromdateiso8601' <<<"$source_json")))
echo "  latest restorable moment: $latest ($lag seconds ago)"
# The copy's security groups, as the source has them (bash 3 has no mapfile, and macOS ships it).
read -r -a groups <<<"$(jq -r '[.VpcSecurityGroups[].VpcSecurityGroupId] | join(" ")' <<<"$source_json")"

started=$(now)
echo "  restoring to $drill"
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier "$prefix" \
  --target-db-instance-identifier "$drill" \
  --use-latest-restorable-time \
  --db-instance-class "$(jq -r .DBInstanceClass <<<"$source_json")" \
  --db-subnet-group-name "$(jq -r .DBSubnetGroup.DBSubnetGroupName <<<"$source_json")" \
  --vpc-security-group-ids "${groups[@]}" \
  --db-parameter-group-name "$(jq -r '.DBParameterGroups[0].DBParameterGroupName' <<<"$source_json")" \
  --no-multi-az --no-publicly-accessible --no-deletion-protection \
  --tags Key=purpose,Value=restore-drill >/dev/null
cleanup() {
  if [[ "$keep" == true ]]; then
    echo "  kept $drill; delete it with: aws rds delete-db-instance --db-instance-identifier $drill --skip-final-snapshot"
  else
    echo "  deleting $drill"
    aws rds delete-db-instance --db-instance-identifier "$drill" --skip-final-snapshot \
      --delete-automated-backups >/dev/null || echo "  could not delete $drill; delete it by hand" >&2
  fi
}
trap cleanup EXIT
aws rds wait db-instance-available --db-instance-identifier "$drill"
restored=$(now)
host="$(aws rds describe-db-instances --db-instance-identifier "$drill" \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
echo "  available after $(minutes $((restored - started))) minutes at $host"

# The check runs as the migration task does, in the cell's network with its secret, pointed at the
# copy instead of the cell's database.
family="$prefix-migrate"
container="$(aws ecs describe-task-definition --task-definition "$family" \
  --query 'taskDefinition.containerDefinitions[0].name' --output text)"
network="$(aws ecs describe-services --cluster "$prefix" --services api \
  --query 'services[0].networkConfiguration' --output json)"
overrides="$(jq -n --arg name "$container" --arg host "$host" \
  '{containerOverrides: [{name: $name, command: ["node", "dist/restore-check.mjs"],
    environment: [{name: "RESTORE_CHECK_HOST", value: $host}]}]}')"
task="$(aws ecs run-task --cluster "$prefix" --launch-type FARGATE --task-definition "$family" \
  --network-configuration "$network" --overrides "$overrides" --started-by restore-drill \
  --query 'tasks[0].taskArn' --output text)"
aws ecs wait tasks-stopped --cluster "$prefix" --tasks "$task"
checked=$(now)
code="$(aws ecs describe-tasks --cluster "$prefix" --tasks "$task" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
log_group="$(aws ecs describe-task-definition --task-definition "$family" \
  --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' --output text)"
stream="$(aws ecs describe-task-definition --task-definition "$family" \
  --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-stream-prefix"' \
  --output text)/$container/${task##*/}"
found="$(aws logs get-log-events --log-group-name "$log_group" --log-stream-name "$stream" \
  --query 'events[-1].message' --output text 2>/dev/null || echo '')"
echo "  check exited $code after $(minutes $((checked - restored))) minutes: $found"

total=$((checked - started))
verdict=pass
[[ "$code" == "0" ]] || verdict=fail
((lag <= 300)) || verdict=fail
((total <= 7200)) || verdict=fail
echo
echo "Record in docs/runbooks/restore-drills.md:"
echo "| $(date -u +%Y-%m-%d) | $environment $cell | $(minutes "$lag") | $(minutes $((restored - started))) | $(minutes "$total") | $verdict |"
[[ "$verdict" == pass ]]
