# Linux-only build for OpenShift binary builds. The source packager supplies a
# filtered context; NEXT_PUBLIC_BACKEND is intentionally fixed at build time.
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/client/package.json packages/client/
COPY tools/migration/package.json tools/migration/
RUN npm ci && npm cache clean --force

FROM deps AS builder
WORKDIR /app
ENV NEXT_PUBLIC_BACKEND=native
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build && rm -rf .next/cache

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_PUBLIC_BACKEND=native \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Next standalone tracing supplies the Linux runtime dependencies. Keep the
# canonical migration runner and idempotent seed entrypoint alongside SQL files.
COPY --from=builder --chown=1001:0 /app/.next/standalone ./
COPY --from=builder --chown=1001:0 /app/.next/static ./.next/static
COPY --from=builder --chown=1001:0 /app/public ./public
COPY --from=builder --chown=1001:0 /app/db ./db

# OpenShift restricted SCC assigns an arbitrary non-root UID. Group 0 access
# mirrors that platform contract while retaining a non-root default elsewhere.
RUN chgrp -R 0 /app && chmod -R g=u /app
USER 1001

EXPOSE 3000
CMD ["node", "server.js"]
