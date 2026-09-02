# Cloud-native deployment (OpenShift / Rancher)

The manifests in this directory deploy the self-contained (native) build of the
VSIS Time Sheet app. The image is built from the repo root `Dockerfile` and
requires a reachable PostgreSQL database supplied via `DATABASE_URL`.

## Prerequisites

- A PostgreSQL 13+ database reachable from the cluster (via an operator such as
  CrunchyData/CloudNativePG, RDS, or any other Postgres). Set its connection
  string in `DATABASE_URL`.
- The container image built and pushed to a registry your cluster can pull from:

  ```bash
  docker build -t <registry>/vsis-timesheet:latest .
  docker push <registry>/vsis-timesheet:latest
  ```

## Deploy

1. Edit `secret.yaml` and set real values for `DATABASE_URL`, `AUTH_SECRET`,
   `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and the SMTP recovery settings
   (`APP_BASE_URL`, `SMTP_HOST`, `SMTP_FROM`, and provider credentials).
2. Point `deployment.yaml`'s `image:` at your pushed image.
3. Apply:

   ```bash
   kubectl apply -f deploy/configmap.yaml \
                  -f deploy/secret.yaml \
                  -f deploy/deployment.yaml \
                  -f deploy/service.yaml
   ```

4. Expose the app — either the nginx Ingress (`deploy/ingress.yaml`, for
   Rancher/nginx) or the OpenShift Route (`deploy/route.yaml`). Adjust the
   hostname in `ingress.yaml`.

## First admin

The app applies its database migrations automatically on startup. Create the
first admin by running the self-contained seed against the same database from
anywhere with `DATABASE_URL` access:

```bash
# From a checkout with dependencies installed:
DATABASE_URL="postgres://..." ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="..." npm run db:seed

# Or from inside the running container (the runtime image includes db/seed.mjs):
kubectl exec -it deploy/vsis-timesheet -- node db/seed.mjs
```

The seed is idempotent: re-running it updates the existing admin's role,
active flag, and password hash rather than creating a duplicate.

## Notes

- `NEXT_PUBLIC_BACKEND` is a build-time setting (baked into the image as
  `native`). `DATABASE_URL`, `AUTH_SECRET`, the admin credentials, and SMTP
  recovery settings are runtime secrets/configuration.
- OpenShift runs pods as an arbitrary UID; the image is non-root and does not
  write to the filesystem, so it runs unmodified. Use `deploy/route.yaml` for
  OpenShift, or an Ingress for Rancher.
- For local development against a container, use `docker compose up` from the
  repo root (see `docker-compose.yml`).

---

## Vercel deployment (manual)

Vercel builds the repo from source using `npm install` + `npm run build`. Set
`NEXT_PUBLIC_BACKEND=supabase` (or `native`) as a build-time environment
variable and configure the appropriate runtime secrets:

### Supabase mode

1. Create a Supabase project and note its URL and anon key.
2. In the Vercel project settings, add:
   - `NEXT_PUBLIC_BACKEND` = `supabase`
   - `NEXT_PUBLIC_SUPABASE_URL` = your project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = your service role key (Server Env /
     "Vercel-Env: production")
3. Deploy the `main` branch — Vercel builds and serves the app. No Docker
   image is involved; Vercel runs its own Next.js runtime.

### Native mode (Vercel)

1. Add `NEXT_PUBLIC_BACKEND=native` as a build-time environment variable.
2. Add runtime environment variables: `DATABASE_URL` (PostgreSQL), `AUTH_SECRET`
   (≥32 chars), `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
3. Deploy. The app auto-runs pending migrations on startup and you can seed
   the first admin with:

   ```bash
   VERCEL="yes" npx vercel env pull .env.local
   # then run the seed locally or via `vercel dev`:
   npm run db:seed
   ```

### Container (Docker) quick start for local dev

```bash
docker compose up -d
# Native backend auto-migrates and seeds from .env.local.
```

## Vercel deployment (supabase mode)

This repo also deploys to Vercel in the hosted `supabase` mode:

1. Import the repository in Vercel (tier: Next.js) — no custom build command or
   output directory is needed.
2. Set the following environment variables in the Vercel project settings
   (Production/Preview/Development), matching `.env.example`:
   - `NEXT_PUBLIC_BACKEND=supabase`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only)
   - `TELEGRAM_BOT_TOKEN` (optional)
3. `NEXT_PUBLIC_BACKEND` is a build-time value: if you change it, trigger a new
   deployment so it is baked in.
4. Apply the Supabase migrations (see `supabase/README.md`) and set up the
   Supabase Auth / RLS policies before going live.

The container-based manifests above target the self-contained `native` build;
use the Vercel flow for the hosted `supabase` deployment.
