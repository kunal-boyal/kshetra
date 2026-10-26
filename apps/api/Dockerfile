# syntax=docker/dockerfile:1
# One image for every cell process (spec 14.3, decision D67): the API (the default command), the
# worker (`node dist/worker.mjs`), the scheduler (`node dist/scheduler.mjs`) and the one-off
# migration (`node dist/migrate.mjs`). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t thelamp-api .

ARG NODE_IMAGE=node:24-bookworm-slim

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
 && pnpm install --prod --no-frozen-lockfile --ignore-scripts

FROM ${NODE_IMAGE} AS runtime
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
USER node
EXPOSE 3000
CMD ["node", "dist/main.mjs"]
