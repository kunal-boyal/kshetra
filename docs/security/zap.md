# ZAP scans

OWASP ZAP's dynamic scans of the product (decisions D100 and D101), run by hand with `tools/zap/scan.sh` before each release and before the penetration test. Each run's reports go to `tools/zap/reports/` (git-ignored); this page keeps what each run found and what was done about it. A false positive goes in `tools/zap/rules.tsv` with the reason.

## What runs

| Scan | Against | How |
|---|---|---|
| Baseline | The web portal, built and served by `vite preview` under the production Content-Security-Policy, with the API behind it | ZAP's spider and AJAX spider over every page it can reach, passive rules only |
| API, anonymous | Every route in `/v1/openapi.json` | Active scan: injection, traversal, header and error-handling attacks on each parameter, without a token |
| API, signed in | The same routes | The same, as a manager signed in on a phone of a fresh load-test tenant, for the 13 minutes the access token gives; the token goes in through `ZAP_AUTH_HEADER_VALUE`, which ZAP doesn't print |

The API runs as in production but for `USER_REQUESTS_PER_MINUTE`, lifted so the per-person limit doesn't answer most of the scan with 429. The portal's preview sends the Content-Security-Policy and the other headers CloudFront sends (`SECURITY_HEADERS` in `infra/modules/web/content-security-policy.mjs`), all but HSTS, as it serves plain HTTP. ZAP runs from its pinned image and reaches the machine as `host.docker.internal`; its replacer sends the Host header the servers expect. The active scans get a 1.5 GB heap and two threads: more outgrows Docker Desktop's 4 GB machine, which then stops ZAP. `tools/zap/scan.sh web api signed-in` runs any of the three alone.

## 2026-10-27 (10c5d)

No high or medium finding was a vulnerability. The active scans sent about 270,000 requests between them; the API answered none with a server error, and the signed-in scan's 403 and 404 answers were the manager's scope and permissions holding.

**Fixed**

| Finding | Where | What was done |
|---|---|---|
| Cross-Origin-Resource-Policy missing (90004) | Every API answer; the portal's files | The API sends `same-origin` on every answer, and CloudFront and the demo's Caddy on the apps' files |
| Cross-Origin-Opener-Policy and -Embedder-Policy missing (90004) | The API reference at `/v1/docs` | The API sends `same-origin` and `require-corp` on every answer |
| Permissions-Policy missing (10063) | The API reference and its scripts | The API sends the policy the web apps' CloudFront sends: no camera, microphone, location, payment or USB |
| X-Content-Type-Options, Permissions-Policy and COOP missing (10021, 10063, 90004) | The portal's preview | Not missing in production, where CloudFront adds them; the previews now send the same headers, so the scans and the end-to-end tests see what production sends |

**Accepted**

| Finding | Where | Why |
|---|---|---|
| CSP: `script-src 'unsafe-eval'` (10055) | The portal | Google's Maps JavaScript API needs it in an allowlist policy, as Google's guide lists; scripts still load only from the portal and Google's map hosts, and nothing inline runs |
| CSP: `style-src 'unsafe-inline'` (10055) | The portal, the console, the API reference | React's style attributes, Google Maps and Scalar write inline styles; styles can't run code, and no inline script is allowed |
| Cross-Origin-Embedder-Policy missing (90004) | The portal | `require-corp` would stop Google Maps' tiles and images, which don't send Cross-Origin-Resource-Policy; COOP and CORP are set |
| Storable but non-cacheable (10049) | The portal's `index.html` | On purpose: `no-cache` makes each visit check for a new release |

**False positives**, in `tools/zap/rules.tsv`: a private address (2) and words like "bug" (10027) and large numbers (10096) inside bundled third-party scripts; the reference page and its scripts being HTML and JavaScript (100001); record IDs such as `userId` in query strings (10024).

**Coverage.** The baseline reached the portal's public pages only (9 URLs: sign-in and its files), as it doesn't sign in; the signed-in screens' headers are the same, set for the whole distribution. The API scans imported all 258 routes of the published document.
