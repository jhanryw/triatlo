# syntax=docker/dockerfile:1
# Production image for apps/web. Build context MUST be the repository root:
#   docker build -f apps/web/Dockerfile -t triatlo-web .
# EasyPanel: GitHub source, build path "/", Dockerfile path "apps/web/Dockerfile".
ARG NODE_IMAGE=node:24.22.2-slim

# ---- deps: install with the lockfile (reproducible) ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/domain/package.json packages/domain/
RUN npm ci --no-audit --no-fund

# ---- build ----
FROM deps AS build
COPY . .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time: pass them as build args
# (EasyPanel exposes service environment variables to the build). Only PUBLIC values belong here.
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=""
ARG NEXT_PUBLIC_PUSH_ENABLED="false"
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_PUSH_ENABLED=$NEXT_PUBLIC_PUSH_ENABLED \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @triatlo/web

# ---- runtime: standalone server, non-root ----
FROM ${NODE_IMAGE} AS runner
ARG APP_COMMIT_SHA=""
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_COMMIT_SHA=$APP_COMMIT_SHA
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
