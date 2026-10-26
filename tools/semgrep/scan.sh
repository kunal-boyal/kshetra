#!/usr/bin/env bash
# Static analysis (spec 13.1, decision D100): Semgrep CE with the registry's packs for this code
# base's languages and the project's own rules, failing on any finding. It runs the pinned image
# through Docker, or the semgrep found on the path inside that image (the nightly CI job).
#
#   tools/semgrep/scan.sh          the rule tests, then the scan
#
# A finding that is safe says why beside it, with `nosemgrep: <rule id>`.
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION=1.180.0
CONFIGS=(
  --config tools/semgrep/rules.yml
  --config p/typescript --config p/javascript --config p/react --config p/nodejs
  --config p/secrets --config p/dockerfile --config p/terraform --config p/github-actions
)

semgrep() {
  if command -v semgrep >/dev/null && [[ "$(command semgrep --version 2>/dev/null)" == "$VERSION" ]]; then
    command semgrep "$@"
  else
    docker run --rm -v "$PWD:/src" -w /src "semgrep/semgrep:$VERSION" semgrep "$@"
  fi
}

semgrep --test --metrics=off tools/semgrep
semgrep scan --metrics=off --error --quiet "${CONFIGS[@]}"
