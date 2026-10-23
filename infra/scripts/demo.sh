#!/usr/bin/env bash
# The demo on one EC2 instance in the AWS sandbox (decision D70). Run from the repository root,
# signed in with `aws login --profile thelamp-sandbox` (or set AWS_PROFILE).
#
#   infra/scripts/demo.sh apply                 creates or updates the instance, bucket and images' registry
#   infra/scripts/demo.sh deploy                builds this commit's images for ARM, pushes them, and
#                                               bootstraps, migrates and restarts the demo with them
#   infra/scripts/demo.sh provision <args...>   makes a demo tenant: pnpm provision's arguments, plus --demo
#   infra/scripts/demo.sh content --tenant <slug> [--days 26]
#                                               fills a new demo tenant with weeks of fictional work
#   infra/scripts/demo.sh pause                 stops the instance between demos (the disk and address remain)
#   infra/scripts/demo.sh resume                starts it again and waits until the demo answers
#   infra/scripts/demo.sh status                says whether it runs, and checks the demo's health
set -euo pipefail
# macOS runs this with its bash 3.2: no inherit_errexit, so the build runs as a plain command,
# where set -e stops a deploy whose build failed.

export AWS_PROFILE="${AWS_PROFILE:-thelamp-sandbox}"
export AWS_REGION=ap-south-1
root="$(cd "$(dirname "$0")/../.." && pwd)"
tf=(terraform -chdir="$root/infra/environments/demo")

output() { "${tf[@]}" output -raw "$1"; }

domain() { output domain; }

# Runs a script on the instance through Session Manager and prints what it printed.
on_box() {
  local instance script parameters command status
  instance="$(output instance_id)"
  script="$1"
  parameters="$(node -e 'console.log(JSON.stringify({ commands: [process.argv[1]], executionTimeout: ["7200"] }))' "$script")"
  command="$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript \
    --parameters "$parameters" --timeout-seconds 600 --query Command.CommandId --output text)"
  status=Pending
  while [[ "$status" =~ ^(Pending|InProgress|Delayed)$ ]]; do
    sleep 5
    status="$(aws ssm get-command-invocation --command-id "$command" --instance-id "$instance" \
      --query Status --output text 2>/dev/null || echo Pending)"
  done
  aws ssm get-command-invocation --command-id "$command" --instance-id "$instance" \
    --query '[StandardOutputContent, StandardErrorContent]' --output text
  [[ "$status" == "Success" ]] || { echo "The instance's script ended: $status" >&2; exit 1; }
}

# Builds the commit's three images for ARM and pushes them, tagged with `$1`.
build() {
  local registry tag="$1"
  registry="$(output registry)"
  {
    aws ecr get-login-password | docker login --username AWS --password-stdin "$registry"
    # The instance is ARM (Graviton), like Apple silicon, so these build natively on a Mac.
    docker buildx build --platform linux/arm64 -f "$root/apps/api/Dockerfile" \
      -t "$registry/thelamp-demo/api:$tag" --push "$root"
    docker buildx build --platform linux/arm64 "$root/infra/docker/postgres" \
      -t "$registry/thelamp-demo/postgres:$tag" --push
    docker buildx build --platform linux/arm64 -f "$root/infra/demo/edge.Dockerfile" \
      -t "$registry/thelamp-demo/edge:$tag" --push "$root"
  } >&2
}

deploy() {
  local registry tag compose parameter
  [[ -z "$(git -C "$root" status --porcelain)" ]] || {
    echo "Commit or stash your changes first: the images are tagged with the commit." >&2
    exit 1
  }
  registry="$(output registry)"
  tag="$(git -C "$root" rev-parse --short=12 HEAD)"
  build "$tag"
  compose="$(base64 <"$root/infra/demo/compose.yaml" | tr -d '\n')"
  parameter="$(output settings_parameter)"
  on_box "set -euo pipefail
cd /opt/thelamp
echo '$compose' | base64 -d >compose.yaml
aws ssm get-parameter --region ap-south-1 --with-decryption --name '$parameter' \
  --query Parameter.Value --output text >settings.env
chmod 600 settings.env
printf 'REGISTRY=%s\nTAG=%s\nDOMAIN=%s\n' '$registry' '$tag' '$(domain)' >.env
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin '$registry'
docker compose pull --quiet
docker compose up -d --wait postgres redis
docker compose run --rm api node dist/bootstrap.mjs
docker compose run --rm api node dist/migrate.mjs
docker compose up -d --remove-orphans
docker image prune -af >/dev/null
docker compose ps --format '{{.Service}} {{.State}}'"
  echo "Deployed $tag to https://$(domain)"
}

provision() {
  local args=""
  for arg in "$@"; do args+=" $(printf '%q' "$arg")"; done
  on_box "set -euo pipefail
cd /opt/thelamp
docker compose run --rm api node dist/provision.mjs --demo$args"
}

content() {
  local args=""
  for arg in "$@"; do args+=" $(printf '%q' "$arg")"; done
  on_box "set -euo pipefail
cd /opt/thelamp
docker compose run --rm api node dist/demo-content.mjs$args"
}

pause() {
  aws ec2 stop-instances --instance-ids "$(output instance_id)" >/dev/null
  aws ec2 wait instance-stopped --instance-ids "$(output instance_id)"
  echo 'The demo is paused: only its disk and address cost anything now.'
}

resume() {
  aws ec2 start-instances --instance-ids "$(output instance_id)" >/dev/null
  aws ec2 wait instance-running --instance-ids "$(output instance_id)"
  for _ in $(seq 1 60); do
    curl -fsS "https://$(domain)/ready" >/dev/null 2>&1 && break
    sleep 5
  done
  status
}

status() {
  aws ec2 describe-instances --instance-ids "$(output instance_id)" \
    --query 'Reservations[0].Instances[0].State.Name' --output text
  curl -fsS "https://$(domain)/ready" && echo || echo "https://$(domain)/ready doesn't answer."
}

case "${1:-}" in
  apply) "${tf[@]}" init -input=false >/dev/null && "${tf[@]}" apply ;;
  deploy) deploy ;;
  provision) shift && provision "$@" ;;
  content) shift && content "$@" ;;
  pause) pause ;;
  resume) resume ;;
  status) status ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' && exit 1 ;;
esac
