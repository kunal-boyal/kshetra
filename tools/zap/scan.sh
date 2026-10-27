#!/usr/bin/env bash
# OWASP ZAP against this machine (decisions D100 and D101): the baseline scan of the web portal,
# passive, over every page its spider finds, and the API scan of the cell from its OpenAPI
# document, active, against every public route, once without a token and once as a manager on a
# phone. Needs Docker and the local services (docker compose up -d) with a migrated database; it
# builds and starts the API and the portal on spare ports bound to this machine, makes a fresh
# load-test tenant for the manager, and stops both after.
#
#   tools/zap/scan.sh                    all three scans; reports in tools/zap/reports/ (git-ignored)
#   tools/zap/scan.sh web api signed-in  any of them
#
# A finding that is a false positive goes in tools/zap/rules.tsv, with why beside it.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Two weeks old when chosen, and pinned by digest.
IMAGE='zaproxy/zap-stable:20261008@sha256:7aaa659b0d43078febd82e29bad112285c370727e86ab8340444220e17d9f0d2'
API_PORT=3901
WEB_PORT=4174
OUT=tools/zap/reports
SCANS="${*:-web api signed-in}"
mkdir -p "$OUT"

pnpm --filter @thelamp/api build >/dev/null
API_PROXY_TARGET="http://127.0.0.1:$API_PORT" pnpm --filter @thelamp/web build >/dev/null

# The per-person limit would answer 429 to most of an active scan, so it is lifted here only.
(cd apps/api && PORT=$API_PORT USER_REQUESTS_PER_MINUTE=1000000 \
  exec node --env-file-if-exists=../../.env dist/main.mjs) >"$OUT/api.log" 2>&1 &
api=$!
(cd apps/web && API_PROXY_TARGET="http://127.0.0.1:$API_PORT" exec pnpm exec vite preview \
  --port $WEB_PORT --strictPort) >"$OUT/web.log" 2>&1 &
web=$!
trap 'kill $api $web 2>/dev/null || true; rm -f "$OUT/session.json"' EXIT

for port in $API_PORT $WEB_PORT; do
  for _ in $(seq 60); do
    curl -s -o /dev/null "http://127.0.0.1:$port/" && break
    sleep 1
  done
done

# Docker Desktop reaches this machine's own addresses as host.docker.internal. The servers check
# the Host header (Vite allows only its own), so ZAP's replacer sends the address they expect.
replace() {
  local i=$1 header=$2 value=$3
  printf -- '-config replacer.full_list(%s).description=%s ' "$i" "$header"
  printf -- '-config replacer.full_list(%s).enabled=true ' "$i"
  printf -- '-config replacer.full_list(%s).matchtype=REQ_HEADER ' "$i"
  printf -- '-config replacer.full_list(%s).matchstr=%s ' "$i" "$header"
  printf -- '-config replacer.full_list(%s).regex=false ' "$i"
  printf -- "-config 'replacer.full_list(%s).replacement=%s' " "$i" "$value"
}
# ZAP reads its rules from its working folder, the reports folder.
cp tools/zap/rules.tsv "$OUT/rules.tsv"
zap() {
  docker run --rm -v "$PWD/$OUT:/zap/wrk:rw" -e ZAP_AUTH_HEADER -e ZAP_AUTH_HEADER_VALUE "$IMAGE" "$@"
}
# The active scans keep every request in memory: ZAP's default heap runs out, and more than
# 1.5 GB outgrows Docker Desktop's 4 GB machine; two threads rather than one a core keep it there.
SCAN="-Xmx1536m -config scanner.threadPerHost=2"
API="http://host.docker.internal:$API_PORT/v1/openapi.json"
wanted() { [[ " $SCANS " == *" $1 "* ]]; }

status=0
if wanted web; then
  # The portal is a single-page app, so the AJAX spider (-j) is what finds its pages.
  zap zap-baseline.py -t "http://host.docker.internal:$WEB_PORT/" -c rules.tsv -j \
    -z "$(replace 0 Host "127.0.0.1:$WEB_PORT")" \
    -r web-baseline.html -J web-baseline.json -I || status=1
fi
if wanted api; then
  zap zap-api-scan.py -t "$API" -f openapi -c rules.tsv \
    -z "$SCAN $(replace 0 Host "127.0.0.1:$API_PORT")" \
    -r api-scan.html -J api-scan.json -I || status=1
fi
if wanted signed-in; then
  # A manager of a fresh tenant, signed in on a phone of their own; the refresh token is spent at
  # this API for an access token, which lasts the 15 minutes the scan is given.
  (cd apps/api && node --env-file-if-exists=../../.env dist/load-fixtures.mjs --users 1 \
    --out "../../$OUT/session.json") >/dev/null
  token=$(node -e '
    const { manager } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    fetch(`http://127.0.0.1:${process.argv[2]}/auth/v1/token/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: manager.refreshToken }),
    }).then((r) => r.json()).then((body) => process.stdout.write(body.session.accessToken));
  ' "$OUT/session.json" "$API_PORT")
  rm "$OUT/session.json"
  # The token goes in through ZAP's own variable, which it never prints, as -z values are.
  ZAP_AUTH_HEADER=Authorization ZAP_AUTH_HEADER_VALUE="Bearer $token" \
    zap zap-api-scan.py -t "$API" -f openapi -c rules.tsv \
    -z "$SCAN $(replace 0 Host "127.0.0.1:$API_PORT") -config scanner.maxScanDurationInMins=13" \
    -r api-scan-signed-in.html -J api-scan-signed-in.json -I || status=1
fi
echo "Reports in $OUT: web-baseline.html, api-scan.html, api-scan-signed-in.html"
exit $status
