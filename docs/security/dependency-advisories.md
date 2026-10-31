# Dependency advisories

`pnpm audit --audit-level high` runs in `pnpm verify` and every night in CI (decision D100). It fails on a high or critical advisory unless the advisory is in `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, and each entry there is reviewed here: where the package reaches, why it can wait, and when to look again. Take a fix as soon as it is two weeks old, then remove its entry.

Moderate and low advisories don't fail the check; Dependabot's alerts list them, and its security updates propose their fixes.

| Advisory | Package | Reaches | Why it waits | Look again |
|---|---|---|---|---|
| GHSA-86w9-cpqp-85rv (high), and from 2026-10-31 GHSA-7wch-p9px-956x, GHSA-jc66-7q78-782g, GHSA-8hrf-8g6f-7xwp, GHSA-hqq3-7jhf-c5jx and GHSA-5x38-2vff-x55p (high) | node-forge ≤ 1.4.0 | Expo's CLI (`@expo/code-signing-certificates`), which signs development builds; it also appears under `drizzle-orm`'s optional `expo-sqlite` peer, which the API never loads | It never reaches the API, the web apps or a phone: nothing parses untrusted certificates, PEM, PKCS#12 or TLS records with it. 1.4.1, released on 2026-10-27, fixes the five new ones, inside the `^1.4.0` range the CLI takes. | 2026-11-10: take 1.4.1 or later, check it closes GHSA-86w9-cpqp-85rv too, then remove the entries |
| GHSA-xjj6-f33q-929c, and from 2026-10-28 GHSA-2m5v-pch6-74hx, GHSA-4w7w-5xrc-9h26 and GHSA-qrxm-fqhp-jwvm (high) | undici 7 and 8 | jsdom and Testcontainers in the test runners; Scalar's reference, built into static files. `pnpm why undici --prod` finds it in nothing that runs in production | Development and build time only: nothing runs it against untrusted servers, and the cache, redirect and TLS faults the three new ones describe need a client talking to one. The same releases fix all four (7.30.1, 8.12.2, released on 2026-10-15). | 2026-10-29: take 7.30.1 and 8.12.2, then remove all four |
| GHSA-mrhx-c7xc-m3w5 (high) | zod 3 | Expo's CLI | zod 3 has no fixed release. Every zod 4, which the apps use, is lifted to 4.6.6 or later by an override. | When Expo's CLI moves to zod 4 |
| GHSA-qr28-fpjm-wq7f (high), from 2026-10-30 | decode-uri-component 0.2.2 | `query-string` 7 under Expo Router on the phone, which decodes the app's own links; it also appears under `drizzle-orm`'s optional `expo-sqlite` peer, which the API never loads | A crafted link opened on the phone could slow only that phone's app. The only fix, 0.5.1 (2026-10-23), is ESM only and outside the `^0.2.2` range `query-string` 7 accepts, so an override would break the router. | When Expo Router moves to a newer `query-string`, or 0.2 gets a fix |

## Fixed

| Advisory | Package | How | When |
|---|---|---|---|
| GHSA-mrhx-c7xc-m3w5 (high) | zod 4 | Catalog raised to `^4.6.6` (4.6.7), and an override for zod 4 that others bring | 2026-10-26 |
| GHSA-gg6h-894w-4m9c (high) | re2js | `packages/forms` raised to `^2.8.8` (2.8.8), once two weeks old | 2026-10-31 |

## Moderate ones in what runs in production, waiting for their fixes to age

| Advisory | Package | Fixed in, released | Take from |
|---|---|---|---|
| GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h | nodemailer (email notices) | 10.1.4, 2026-10-18 | 2026-11-01 |
| GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr and two low | fast-uri under Fastify | 4.2.3, 2026-10-19 | 2026-11-02 |
| GHSA-389g-gv7q-r4x8 (low) | fastify | 5.12.6, 2026-10-13 | 2026-10-27 |
