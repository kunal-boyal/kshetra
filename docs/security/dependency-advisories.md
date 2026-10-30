# Dependency advisories

`pnpm audit --audit-level high` runs in `pnpm verify` and every night in CI (decision D100). It fails on a high or critical advisory unless the advisory is in `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, and each entry there is reviewed here: where the package reaches, why it can wait, and when to look again. Take a fix as soon as it is two weeks old, then remove its entry.

Moderate and low advisories don't fail the check; Dependabot's alerts list them, and its security updates propose their fixes.

| Advisory | Package | Reaches | Why it waits | Look again |
|---|---|---|---|---|
| GHSA-86w9-cpqp-85rv (high) | node-forge ≤ 1.4.0 | Expo's CLI, which signs development builds | No fixed release exists. It never reaches the API, the web apps or a phone. | When node-forge or Expo's CLI publishes a fix |
| GHSA-xjj6-f33q-929c, and from 2026-10-28 GHSA-2m5v-pch6-74hx, GHSA-4w7w-5xrc-9h26 and GHSA-qrxm-fqhp-jwvm (high) | undici 7 and 8 | jsdom and Testcontainers in the test runners; Scalar's reference, built into static files. `pnpm why undici --prod` finds it in nothing that runs in production | Development and build time only: nothing runs it against untrusted servers, and the cache, redirect and TLS faults the three new ones describe need a client talking to one. The same releases fix all four (7.30.1, 8.12.2, released on 2026-10-15). | 2026-10-29: take 7.30.1 and 8.12.2, then remove all four |
| GHSA-mrhx-c7xc-m3w5 (high) | zod 3 | Expo's CLI | zod 3 has no fixed release. Every zod 4, which the apps use, is lifted to 4.6.6 or later by an override. | When Expo's CLI moves to zod 4 |
| GHSA-gg6h-894w-4m9c (high), from 2026-10-30 | re2js 2.2.0 to 2.8.6 | The form engine (`packages/forms`): `compilePattern()` on the server, the portal and the phone | The slowdown is quadratic in lookbehind matching. The patterns are a tenant admin's own configuration, and the text they match is a field value of at most 500 characters, so the worst case stays small. The fix, 2.8.7, was released on 2026-10-17. | 2026-10-31: take 2.8.7 or later, then remove the entry |
| GHSA-qr28-fpjm-wq7f (high), from 2026-10-30 | decode-uri-component 0.2.2 | `query-string` 7 under Expo Router on the phone, which decodes the app's own links; it also appears under `drizzle-orm`'s optional `expo-sqlite` peer, which the API never loads | A crafted link opened on the phone could slow only that phone's app. The only fix, 0.5.1 (2026-10-23), is ESM only and outside the `^0.2.2` range `query-string` 7 accepts, so an override would break the router. | When Expo Router moves to a newer `query-string`, or 0.2 gets a fix |

## Fixed

| Advisory | Package | How | When |
|---|---|---|---|
| GHSA-mrhx-c7xc-m3w5 (high) | zod 4 | Catalog raised to `^4.6.6` (4.6.7), and an override for zod 4 that others bring | 2026-10-26 |

## Moderate ones in what runs in production, waiting for their fixes to age

| Advisory | Package | Fixed in, released | Take from |
|---|---|---|---|
| GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h | nodemailer (email notices) | 10.1.4, 2026-10-18 | 2026-11-01 |
| GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr and two low | fast-uri under Fastify | 4.2.3, 2026-10-19 | 2026-11-02 |
| GHSA-389g-gv7q-r4x8 (low) | fastify | 5.12.6, 2026-10-13 | 2026-10-27 |
