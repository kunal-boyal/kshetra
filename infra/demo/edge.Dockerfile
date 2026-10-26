# The demo's edge (decision D70): the web portal's build, served by Caddy. Build from the root:
#   docker build -f infra/demo/edge.Dockerfile .
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @thelamp/web build
# The portal's Content-Security-Policy as CloudFront sends it (decision D101), as a Caddy snippet;
# the demo's photos come straight from its bucket.
ARG MEDIA_ORIGIN=https://*.s3.ap-south-1.amazonaws.com
RUN printf 'header Content-Security-Policy "%s"\n' \
    "$(node infra/modules/web/content-security-policy.mjs --maps --media "$MEDIA_ORIGIN")" > /repo/csp.caddy

FROM caddy:2.11.7
COPY infra/demo/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/csp.caddy /etc/caddy/csp.caddy
COPY --from=build /repo/apps/web/dist /srv
