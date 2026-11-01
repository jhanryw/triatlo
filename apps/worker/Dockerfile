# syntax=docker/dockerfile:1
# Production image for apps/worker. Build context MUST be the repository root:
#   docker build -f apps/worker/Dockerfile -t triatlo-worker .
# EasyPanel: GitHub source, build path "/", Dockerfile path "apps/worker/Dockerfile". No public domain.
ARG NODE_IMAGE=node:24.22.2-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/domain/package.json packages/domain/
COPY packages/ingest/package.json packages/ingest/
COPY packages/data/package.json packages/data/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# esbuild bundles the worker and the workspace packages into a single file.
RUN npm run build -w @triatlo/worker

FROM ${NODE_IMAGE} AS runner
ARG APP_COMMIT_SHA=""
ENV NODE_ENV=production \
    WORKER_HEALTH_PORT=8081 \
    APP_COMMIT_SHA=$APP_COMMIT_SHA
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/worker/dist/main.mjs ./main.mjs
USER node
# Internal-only health probe (do not publish this port).
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||8081)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "main.mjs"]
