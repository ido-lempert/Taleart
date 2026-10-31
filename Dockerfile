# syntax=docker/dockerfile:1.7
#
# TaleArt images, built from this repository:
#   docker build --target api       -t taleart/api       .
#   docker build --target dashboard -t taleart/dashboard .
# docker-compose.yml builds both for you.

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# build: install the workspace and run the Nx builds (Web SDK, API, dashboard).
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /repo
ENV NX_DAEMON=false NX_NO_CLOUD=true NX_TUI=false CI=true NODE_ENV=development

COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY . .
# The Android and iOS SDKs are not part of the install and need Java: drop the Gradle plugin from the
# Nx config inside the image (the repository's nx.json is not changed).
RUN node -e "const f='nx.json',c=JSON.parse(require('fs').readFileSync(f,'utf8'));c.plugins=c.plugins.filter(p=>!String(p.plugin||p).includes('gradle'));require('fs').writeFileSync(f,JSON.stringify(c,null,2))"

# API: webpack bundle (Web SDK built first), it also writes the production package.json and lockfile.
RUN node_modules/.bin/nx build api --skip-nx-cache
# Dashboard: Angular SSR build (browser + server).
RUN node_modules/.bin/nx build dashboard --configuration=production --skip-nx-cache

# Production dependencies of the API only.
WORKDIR /repo/dist/apps/api
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund --legacy-peer-deps

# ---------------------------------------------------------------------------
# api
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS api
RUN apk add --no-cache tini
ENV NODE_ENV=production PORT=3333 \
    MEDIA_DIR=/data/media SDK_BUILDS_DIR=/data/sdk-builds TRUST_PROXY=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/dist/apps/api ./
COPY --chmod=755 deploy/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN mkdir -p /data/media /data/sdk-builds && chown -R node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/api-entrypoint.sh"]
CMD ["node", "main.js"]

# ---------------------------------------------------------------------------
# dashboard
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS dashboard
RUN apk add --no-cache tini
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /repo/dist/apps/dashboard ./
COPY --chmod=755 deploy/dashboard-entrypoint.sh /usr/local/bin/dashboard-entrypoint.sh
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/',{headers:{host:'localhost'}}).then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/dashboard-entrypoint.sh"]
CMD ["node", "server/server.mjs"]
