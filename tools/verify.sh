#!/usr/bin/env bash
# The full check before a merge (decision D75): what CI runs on main, run on this machine, so
# pull requests need only GitHub's quick checks. Docker must be running (integration tests).
#
#   tools/verify.sh            formatting, types, lint, unit, phone, integration and web end to end,
#                              Terraform, static analysis and the dependency audit
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
# Four files at a time: the suite shares one PostgreSQL in Docker, and run wider, its long files
# (the contract test, the demo content) outlast their access tokens and timeouts.
pnpm --filter @thelamp/api test:int -- --maxWorkers=4
step 'End to end (web, with axe)'
pnpm test:e2e
step 'Terraform'
terraform fmt -recursive -check infra
# Whether an environment holds its providers for this machine, such as darwin_arm64.
platform=$(terraform version -json | sed -n 's/.*"platform": *"\([^"]*\)".*/\1/p')
providers() { compgen -G "$1.terraform/providers/registry.terraform.io/*/*/*/$platform" >/dev/null; }
# Providers one environment on this machine already holds, for others set up without theirs.
cache=''
for environment in infra/environments/*/; do
  if providers "$environment"; then cache="$PWD/$environment.terraform/providers"; fi
done
for environment in infra/environments/*/; do
  # Only environments set up on this machine: validating the rest would fetch their providers.
  [[ -d "$environment/.terraform" ]] || continue
  if ! providers "$environment" && [[ -n "$cache" ]]; then
    # Offline, from the cache, keeping the committed lock file as it is.
    terraform -chdir="$environment" init -backend=false -input=false -lockfile=readonly \
      -plugin-dir="$cache" >/dev/null
  fi
  terraform -chdir="$environment" validate
done
# Semgrep's rule tests and scan, then known advisories above moderate (decision D100).
step 'Static analysis'
tools/semgrep/scan.sh
step 'Dependency audit'
pnpm audit --audit-level high
step 'Shell scripts'
if command -v shellcheck >/dev/null; then shellcheck infra/scripts/*.sh; else echo 'shellcheck is not installed: skipped'; fi
if [[ "${1:-}" == '--image' ]]; then
  step 'Container image'
  docker build -q -f apps/api/Dockerfile . >/dev/null
fi

printf '\nEverything passed at %s.\n' "$(git rev-parse --short HEAD)"
