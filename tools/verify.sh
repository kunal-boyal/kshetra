#!/usr/bin/env bash
# The full check before a merge (decision D75): what CI runs on main, run on this machine, so
# pull requests need only GitHub's quick checks. Docker must be running (integration tests).
#
#   tools/verify.sh            formatting, types, lint, unit, phone, integration and web end to end
#   tools/verify.sh --image    and the cell's container image as well
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n== %s\n' "$1"; }

step 'Formatting'
pnpm format:check
step 'Types'
pnpm typecheck
step 'Lint'
pnpm lint
# One package at a time, on two workers each: run wider, the web and phone suites time out on a
# busy laptop.
step 'Unit tests'
pnpm turbo run test --concurrency=1 --filter='!@thelamp/mobile' --filter='!@thelamp/ui-mobile' -- --maxWorkers=2
step 'Phone unit tests'
pnpm --filter @thelamp/ui-mobile test
pnpm --filter @thelamp/mobile test
step 'Integration tests'
pnpm test:int
step 'End to end (web, with axe)'
pnpm test:e2e
step 'Terraform'
terraform fmt -recursive -check infra
for environment in infra/environments/*/; do
  # Only environments set up on this machine: validating the rest would fetch their providers.
  if [[ -d "$environment/.terraform" ]]; then terraform -chdir="$environment" validate; fi
done
step 'Shell scripts'
if command -v shellcheck >/dev/null; then shellcheck infra/scripts/*.sh; else echo 'shellcheck is not installed: skipped'; fi
if [[ "${1:-}" == '--image' ]]; then
  step 'Container image'
  docker build -q -f apps/api/Dockerfile . >/dev/null
fi

printf '\nEverything passed at %s.\n' "$(git rev-parse --short HEAD)"
