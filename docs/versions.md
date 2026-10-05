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
| zod | 4.6.5 | Validation: the API's config and requests, and the configuration schemas in `packages/shared`, `forms`, `metrics` and `templates` |
| ajv | 8.20.0 | `packages/templates` tests, which check each template against the generated `schema.json` |

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
| testcontainers, @testcontainers/postgresql | 12.2.0 | Integration tests against `infra/docker/postgres` |
| @types/node | 24.19.1 | Matches the Node 24 runtime, not the newest 26.x |

## Install scripts

pnpm 12 runs a dependency's install script only when `allowBuilds` in `pnpm-workspace.yaml` approves it. Only esbuild is approved, because it sets up the native binary that drizzle-kit, Vite and tsdown need. ssh2, cpu-features and protobufjs are denied: the first two only serve Docker over SSH, and the last only prints notices. Review any new request before approving it.

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
