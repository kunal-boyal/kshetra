# Dependency advisories

`pnpm audit --audit-level high` runs in `pnpm verify` and every night in CI (decision D100). It fails on a high or critical advisory unless the advisory is in `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, and each entry there is reviewed here: where the package reaches, why it can wait, and when to look again. Take a fix as soon as it is two weeks old, then remove its entry.

Moderate and low advisories don't fail the check; Dependabot's alerts list them, and its security updates propose their fixes.

| Advisory | Package | Reaches | Why it waits | Look again |
|---|---|---|---|---|
| GHSA-86w9-cpqp-85rv (high) | node-forge ≤ 1.4.0 | Expo's CLI, which signs development builds | No fixed release exists. It never reaches the API, the web apps or a phone. | When node-forge or Expo's CLI publishes a fix |
| GHSA-xjj6-f33q-929c, and from 2026-10-28 GHSA-2m5v-pch6-74hx, GHSA-4w7w-5xrc-9h26 and GHSA-qrxm-fqhp-jwvm (high) | undici 7 and 8 | jsdom and Testcontainers in the test runners; Scalar's reference, built into static files. `pnpm why undici --prod` finds it in nothing that runs in production | Development and build time only: nothing runs it against untrusted servers, and the cache, redirect and TLS faults the three new ones describe need a client talking to one. The same releases fix all four (7.30.1, 8.12.2, released on 2026-10-15). | 2026-10-29: take 7.30.1 and 8.12.2, then remove all four |
| GHSA-mrhx-c7xc-m3w5 (high) | zod 3 | Expo's CLI | zod 3 has no fixed release. Every zod 4, which the apps use, is lifted to 4.6.6 or later by an override. | When Expo's CLI moves to zod 4 |

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
