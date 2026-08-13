# ---- build stage --------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# The container image is the cloud-native build: native mode is baked in at
# build time (NEXT_PUBLIC_* is inlined into the client bundle).
ENV NEXT_PUBLIC_BACKEND=native

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime stage ------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_PUBLIC_BACKEND=native
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Run as a non-root user (OpenShift enforces arbitrary UIDs; a numeric user is
# compatible with that).
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server output (includes db/migrations, traced by output file tracing).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets and public files are not part of the standalone bundle.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Seed script + migrations for the one-off `node db/seed.mjs` admin bootstrap.
COPY --from=builder --chown=nextjs:nodejs /app/db ./db

USER nextjs

EXPOSE 3000

# Runtime configuration comes from the environment (DATABASE_URL, AUTH_SECRET).
CMD ["node", "server.js"]
