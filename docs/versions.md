# Versions

Each dependency uses its current stable release on the day it is added (spec section 0, rule 6). `pnpm-lock.yaml` pins the exact versions, and the shared tools are declared once in the `catalog` of `pnpm-workspace.yaml`. This file records what was chosen, and why anything was held back.

## Runtime and tooling (added 2026-10-05)

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 (LTS) | Set in `.nvmrc`. Developed on 24.16.0. |
| pnpm | 12.9.1 | Set in `packageManager`. |
| Turborepo | 2.11.7 | |
| TypeScript | 6.0.3 | Held back from 7.0.2, because typescript-eslint 8.71 supports TypeScript below 6.1. Move to 7 when typescript-eslint does; the catalog pins `~6.0.3` until then. |
| ESLint | 10.12.0 | Flat config, in `packages/config/eslint.js` |
| typescript-eslint | 8.71.0 | |
| @eslint/js | 10.0.1 | |
| eslint-config-prettier | 10.1.8 | |
| globals | 17.13.0 | |
| Prettier | 3.9.9 | |
| Vitest | 5.0.3 | |

## Libraries

| Package | Version | Used by |
|---|---|---|
| uuid | 14.0.2 | `packages/shared`, for UUID v7 ids |
| libphonenumber-js | 1.13.14 | `packages/shared`, for E.164 phone numbers |
| zod | 4.6.5 | Validation: the API's config and requests, and the configuration schemas in `packages/shared`, `forms`, `metrics` and `templates` |
| ajv | 8.20.0 | `packages/templates` tests, which check each template against the generated `schema.json` |
| re2js | 2.8.6 | Added 2026-10-13: `packages/forms`, which matches text fields' patterns in linear time, on the server and in the apps alike (decision D45) |

## API (`apps/api`, added 2026-10-05)

| Package | Version | Notes |
|---|---|---|
| @nestjs/core, common, platform-fastify, testing | 12.1.2 | ESM-native, on Fastify 5.12.5 (decision D22) |
| reflect-metadata | 0.2.2 | Decorator metadata for NestJS dependency injection |
| rxjs | 7.8.2 | Peer dependency of NestJS |
| drizzle-orm | 0.45.3 | The latest stable release. 1.0 is still a release candidate; move to it once it's stable. |
| drizzle-kit | 0.31.11 | Generates migrations (`pnpm --filter @kshetra/api db:generate`) |
| pg | 8.23.1 | The PostgreSQL driver, with @types/pg 8.23.1 |
| tsdown | 0.23.0 | Bundles the API and its workspace packages |
| testcontainers, @testcontainers/postgresql, @testcontainers/redis | 12.2.0 | Integration tests against `infra/docker/postgres` and Redis |
| jose | 6.2.12 | ES256 access tokens and the JWKS (decision D29) |
| ioredis | 6.0.0 | The Redis client: sign-in rate limits and tickets, and the connection BullMQ uses |
| bullmq | 6.3.11 | Background jobs and schedules (decision D39). BullMQ 6 replaces repeatable jobs with job schedulers. |
| @types/node | 24.19.1 | Matches the Node 24 runtime, not the newest 26.x |
| @fastify/cookie | 11.1.2 | The web's refresh cookie (decision D35) |
| @fastify/cors | 11.3.0 | The `CORS_ORIGINS` allowlist (decision D35) |
| @aws-sdk/client-s3 | 3.1146.0 | Added 2026-10-12: the object store, S3 in AWS and MinIO locally (decision D42) |
| read-excel-file | 9.3.10 | Added 2026-10-12: reads `.xlsx` imports. Numbers are read as the text in the cell, so codes and mobile numbers keep their leading zeros (decision D42). |
| exceljs | 4.4.0 | Added 2026-10-22: writes `.xlsx` exports with its streaming writer, numbers as numbers and dates as dates (decision D62). 4.4.0 is the current release. |
| csv-parse | 7.0.3 | Added 2026-10-12: reads `.csv` imports |
| fflate | 0.8.3 | Added 2026-10-12: reads an `.xlsx` file's zip directory to refuse one that unpacks to more than 200 MB before it is opened (decision D42) |
| sharp | 0.35.5 | Added 2026-10-12: reads photos, makes their thumbnails, stamped copies and difference hashes (decision D44). Its prebuilt binaries need no install script. |
| nodemailer | 10.1.1 | Added 2026-10-16: sends notification email over SMTP, to Mailpit locally and Amazon SES in AWS (decision D58). It ships its own types. |
| @vis.gl/react-google-maps | 1.10.1 | Added 2026-10-21: the web's maps on the Maps JavaScript API, Google's own React library (decision D60). |
| echarts | 6.1.0 | Added 2026-10-22: the web's charts, as spec 9.1 names, loaded piece by piece from `echarts/core` with the SVG renderer (decision D63). |
| @aws-sdk/s3-request-presigner | 3.1146.0 | Added 2026-10-12: upload and read links for photos, matching the S3 client |
| @aws-sdk/cloudfront-signer | 3.1149.0 | Added 2026-10-12: CloudFront signed read links in AWS (decision D44) |

## Web (`apps/web`, `packages/ui-web`, `packages/api-client`, added 2026-10-06)

| Package | Version | Notes |
|---|---|---|
| react, react-dom | 19.3.0 | With @types/react and @types/react-dom 19.3.0, in the catalog |
| vite | 8.3.3 | The dev server and build, with @vitejs/plugin-react 6.1.2 |
| @tanstack/react-router | 1.170.41 | Routes defined in code |
| @tanstack/react-query | 5.104.1 | Server state, such as the config bundle with its ETag |
| tailwindcss, @tailwindcss/vite | 4.3.3 | Layout utilities, with the tokens mapped into the theme |
| lucide-react | 1.52.0 | Icons (decision D18) |
| @fontsource-variable/noto-sans | 5.3.0 | Self-hosted Noto Sans |
| @fontsource/noto-sans-devanagari | 5.3.0 | Self-hosted Noto Sans Devanagari, weights 400 and 600 |
| @playwright/test | 1.63.0 | End-to-end tests, in Chromium |
| @axe-core/playwright | 4.13.0 | Accessibility checks in the end-to-end tests |
| jsdom | 30.1.2 | The DOM for component tests |
| @testing-library/react | 16.3.3 | With @testing-library/jest-dom 7.0.1 and @testing-library/user-event 14.6.7 |
| eslint-plugin-react-hooks | 7.1.1 | In the `@kshetra/config/eslint-react` preset |

pnpm installs a release only once it is a day old (`minimumReleaseAge`). Vite 8.3.3 and @vitejs/plugin-react 6.1.2 were the current stable releases but younger than that when they were added, so `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` admits those exact versions. Remove the entries when either package is next upgraded.

## Mobile (`apps/mobile`, `packages/ui-mobile`, added 2026-10-06)

Expo SDK 57 is the current stable SDK; SDK 58 is still in beta. The SDK fixes most of these versions, and `pnpm exec expo install --check` in `apps/mobile` confirms them. The versions `packages/ui-mobile` shares with the app sit in the `mobile` catalog of `pnpm-workspace.yaml`, so the app loads a single React (decision D36). Move `expo` and `jest-expo` by editing that catalog, and the other modules with `pnpm exec expo install <package>`: `expo install --fix` writes a version over a catalog entry and leaves two copies of Expo. A patch that changes a native module reaches a phone only in a new development build.

| Package | Version | Notes |
|---|---|---|
| expo | 57.0.30 | SDK 57; moved from 57.0.26 on 2026-10-14, from 57.0.28 on 2026-10-16 and from 57.0.29 on 2026-10-21, each time through the `mobile` catalog, with the modules the patch names. `expo install --check` is clean |
| react-native | 0.86.3 | The New Architecture |
| react, react-dom | 19.2.3 | The SDK's React; the web stays on 19.3 |
| expo-router | 57.0.28 | Routes in `src/app` |
| expo-notifications | 57.0.23 | Added 2026-10-21 for push on the phone (decision D59): permission, the Expo push token, the Android channel and taps. Push needs a development build and the Firebase `google-services.json` in it. |
| react-native-maps | 1.27.2 | Added 2026-10-21 with `expo install` for maps on the phone (decision D61): Google Maps on Android through its config plugin and `GOOGLE_MAPS_ANDROID_KEY`. Native, so it needs a development build; Expo Go carries its own copy. No web build: the field app's web target uses `src/maps.web.tsx`. |
| expo-secure-store, expo-crypto, expo-device, expo-localization, expo-font, expo-constants, expo-linking | 57.0.4, 57.0.4, 57.0.2, 57.0.2, 57.0.4, 57.0.22, 57.0.13 | The session and device key, the phone's details and language, fonts, configuration and links |
| expo-splash-screen, expo-status-bar, expo-system-ui, expo-dev-client | 57.0.10, 57.0.1, 57.0.4, 57.0.20 | Start-up, system bars, and the development client of spec 9.2 |
| expo-sqlite, expo-network, expo-battery | 57.0.4, 57.0.2, 57.0.3 | Added 2026-10-07 for the offline sync (decision D40): the phone's database, the network returning, and battery optimisation for the heartbeat. All three are in Expo Go. |
| expo-location | 57.0.21 | Added 2026-10-12 for accounts (decision D43): a fix while the app is open, to sort places by distance and propose where one is. Foreground only; tracking adds background use in step 8. In Expo Go. |
| expo-task-manager | 57.0.21 | Added 2026-10-13 for tracking (decision D48): the background location task. Background location needs a development build; Expo Go can't run it. |
| expo-camera, expo-image-manipulator, expo-file-system | 57.0.6, 57.0.21, 57.0.7 | Added 2026-10-12 for photos (decision D44): the live camera without the microphone, resizing, and the app's own storage for photos waiting to upload. All in Expo Go. |
| react-native-screens, react-native-safe-area-context, react-native-gesture-handler | 4.26.2, 5.7.0, 2.32.0 | For the router |
| react-native-reanimated, react-native-worklets | 4.5.1, 0.10.1 | The versions Expo Go carries, pinned because the router names them as optional peers and pnpm would otherwise install newer native code |
| react-native-svg | 15.15.4 | Icons and the mark |
| react-native-web | 0.21.3 | The development-only web target |
| lucide-react-native | 1.52.0 | Icons, the same release as `lucide-react` |
| @expo-google-fonts/noto-sans, @expo-google-fonts/noto-sans-devanagari | 0.4.2, 0.4.1 | Loaded on iOS and the web target only (D36) |
| @tanstack/react-query | 5.104.1 | As on the web |
| jest, @jest/globals | 29.7.0 | Held back from Jest 30.5, because jest-expo 57 runs on Jest 29. Move with jest-expo. |
| jest-expo | 57.0.6 | The SDK's Jest preset |
| @testing-library/react-native | 14.0.1 | Its `render` and `fireEvent` are async |
| test-renderer | 1.2.0 | Held below 1.3, which renders with React 19.3's reconciler |
| @react-native/metro-config | 0.86.3 | Pinned to React Native's version for a peer dependency |

The EAS command-line tool (eas-cli 24.11.0) is installed globally on Kunal's machine rather than in the workspace, as Expo recommends.

## Install scripts

pnpm 12 runs a dependency's install script only when `allowBuilds` in `pnpm-workspace.yaml` approves it. Only esbuild is approved, because it sets up the native binary that drizzle-kit, Vite and tsdown need. ssh2, cpu-features, protobufjs and msgpackr-extract are denied: the first two only serve Docker over SSH, protobufjs only prints notices, and msgpackr-extract is an optional native speed-up that BullMQ's MessagePack works without. Review any new request before approving it.

## Local services (`docker-compose.yml`)

| Service | Version | Notes |
|---|---|---|
| PostgreSQL | 18.6 | Built from `postgres:18`, with PostGIS 3.6.4, pg_partman 5.5.0 and pg_trgm 1.6 from the PostgreSQL apt repository. The `postgis/postgis` images are Intel-only. Amazon RDS supports PostgreSQL 18 with PostGIS 3.6 and pg_partman 5.4. Published on port 5433 by default (`POSTGRES_PORT`). |
| Redis | 8.10 | `redis:8.10`. Published on port 6380 by default (`REDIS_PORT`), so a Redis already installed on the machine can keep 6379. |
| Mailpit | 1.31.4 | `axllent/mailpit:v1.31`: SMTP on 1025, inbox at http://localhost:8025 |
| MinIO (stands in for S3) | RELEASE.2026-09-22T19-25-18Z | Chainguard's `cgr.dev/chainguard/minio:latest`, built from MinIO's source (decision D21). The free tier floats on `latest`, so record the version when it changes: `docker compose exec minio minio --version`. API on 9000, console at http://localhost:9001, region `ap-south-1`. |

## CI (GitHub Actions)

| Action | Version |
|---|---|
| actions/checkout | v7 |
| pnpm/action-setup | v6 |
| actions/setup-node | v7 |
