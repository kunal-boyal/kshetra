# syntax=docker/dockerfile:1
# One image for every cell process (spec 14.3, decision D67): the API (the default command), the
# worker (`node dist/worker.mjs`), the scheduler (`node dist/scheduler.mjs`) and the one-off
# migration (`node dist/migrate.mjs`). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t thelamp-api .

# Pinned by digest (ASVS V15.1.2, decision D101), so the same bytes build every time; Dependabot
# proposes a newer one monthly, and a release is taken once it is two weeks old.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @thelamp/api build
# The build bundles the workspace packages, so the image needs only the API's npm packages. The
# shared lockfile resolves drizzle-orm with the phone's optional peers, so the deployed copy
# resolves again without automatic peers: the locked versions stay, and Expo stays out.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @thelamp/api deploy --prod /deploy \
 && cd /deploy \
 && sed -i 's/^autoInstallPeers: true/autoInstallPeers: false/' pnpm-workspace.yaml \
 && rm -rf node_modules \
 && pnpm install --prod --no-frozen-lockfile --ignore-scripts \
 && pnpm sbom --sbom-format cyclonedx --sbom-type application --prod --out /deploy/sbom.cdx.json

FROM ${NODE_IMAGE} AS runtime
# `demo` keeps the demo's content generator (decision D70); every other image leaves it out.
ARG PURPOSE=live
# RDS requires TLS (rds.force_ssl), and its certificate authority isn't in Node's store: database
# URLs use sslmode=verify-full against Amazon's bundle.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 \
    NODE_EXTRA_CA_CERTS=/app/certs/rds-global-bundle.pem
WORKDIR /app
# The photo stamp draws its text in Noto Sans, Devanagari included (decision D44).
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-core fontconfig \
 && rm -rf /var/lib/apt/lists/*
# Pinned by checksum (decision D101): when Amazon publishes a new bundle the build fails, and the
# new checksum is taken after reading what changed.
ADD --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b --chown=node:node \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem certs/rds-global-bundle.pem
COPY --from=build --chown=node:node /deploy/package.json ./
COPY --from=build --chown=node:node /deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/drizzle ./drizzle
# The npm packages inside, as CycloneDX (ASVS V15.1.2): read it with
#   docker run --rm <image> cat sbom.cdx.json
COPY --from=build --chown=node:node /deploy/sbom.cdx.json ./sbom.cdx.json
# Development and test entry points stay out of what runs in AWS (ASVS V15.2.3, decision D101):
# the seed, the load and end-to-end fixtures and the OpenAPI writer refuse live databases anyway.
RUN rm dist/seed.mjs dist/load-fixtures.mjs dist/e2e-fixtures.mjs dist/openapi.mjs \
 && if [ "$PURPOSE" != demo ]; then rm dist/demo-content.mjs; fi
USER node
EXPOSE 3000
CMD ["node", "dist/main.mjs"]
