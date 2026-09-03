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
   `RATE_LIMIT_SUBJECT_SECRET`, `CRON_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
   and the SMTP recovery settings (`APP_BASE_URL`, `SMTP_HOST`, `SMTP_FROM`, and
   provider credentials).
2. Point `deployment.yaml`'s `image:` at your pushed image.
3. Apply:

   ```bash
   kubectl apply -f deploy/configmap.yaml \
                  -f deploy/secret.yaml \
                  -f deploy/deployment.yaml \
                  -f deploy/service.yaml \
                  -f deploy/cronjob.yaml
   ```

4. Expose the app over HTTPS — either the nginx Ingress (`deploy/ingress.yaml`,
   for Rancher/nginx) or the OpenShift Route (`deploy/route.yaml`). Adjust the
   hostname in `ingress.yaml` and create the TLS secret it references. See
   [Transport security](#transport-security) below; neither manifest should be
   applied as-is without reading it.

   ```bash
   kubectl apply -f deploy/ingress.yaml   # Rancher / nginx
   oc apply -f deploy/route.yaml          # OpenShift
   ```

## Transport security

The app sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`, and a CSP in `next.config.ts`. It deliberately does **not**
set `Strict-Transport-Security`: HSTS is only meaningful on a connection that
already terminated TLS, so emitting it from the application would advertise a
policy the app cannot honour when it is served over plain HTTP behind a proxy.
It is configured at the edge instead.

### nginx Ingress (Rancher / plain Kubernetes)

`deploy/ingress.yaml` expects a TLS secret named `vsis-timesheet-tls` in the same
namespace. Create it from operator-supplied material — never commit certificates:

```bash
kubectl create secret tls vsis-timesheet-tls \
  --cert=/path/to/fullchain.pem \
  --key=/path/to/privkey.pem
```

With cert-manager, drop the manual secret and add an issuer annotation instead:

```yaml
cert-manager.io/cluster-issuer: letsencrypt-prod
```

The manifest then supplies:

- `spec.tls` — terminates TLS for the host.
- `nginx.ingress.kubernetes.io/ssl-redirect: "true"` — 308-redirects HTTP to HTTPS.
- `nginx.ingress.kubernetes.io/configuration-snippet` — adds the HSTS response
  header. The ingress-controller-level `hsts` options are ConfigMap-wide, so the
  snippet keeps the policy scoped to this Ingress.

Some hardened clusters disable `configuration-snippet`
(`allow-snippet-annotations: "false"`). If yours does, set the equivalent keys in
the ingress-controller ConfigMap instead: `hsts: "true"`,
`hsts-max-age: "31536000"`, `hsts-include-subdomains: "false"`,
`hsts-preload: "false"`.

### OpenShift Route

`deploy/route.yaml` uses `termination: edge` and **omits**
`insecureEdgeTerminationPolicy`, which makes the router reject plain HTTP rather
than serve it in clear — that is already the safe default. Set it to `Redirect`
only if you want HTTP clients bounced to HTTPS as a convenience; `Allow` would
serve the app over plain HTTP and must not be used.

HSTS comes from `haproxy.router.openshift.io/hsts_header`, which the manifest
sets. OpenShift ignores that annotation on non-TLS routes, so keep the `tls`
block.

### HSTS policy

Both edges emit exactly:

```text
Strict-Transport-Security: max-age=31536000
```

One year, and deliberately **without** `includeSubDomains` or `preload`.
`includeSubDomains` would force HTTPS on every sibling hostname under the parent
domain, including unrelated services; `preload` is effectively irreversible once
the domain is submitted to the browser preload list. Add either only as a
separate, deliberate decision with the whole domain surveyed.

### Verify

```bash
# HTTP is redirected (nginx) or refused (OpenShift default).
curl -sS -o /dev/null -D - http://timesheet.example.com/

# HTTPS carries a one-year HSTS policy and no includeSubDomains/preload.
curl -sSI https://timesheet.example.com/ | grep -i strict-transport-security

# Health is minimal unless HEALTH_DEBUG=true.
curl -sS https://timesheet.example.com/api/health

# Cleanup rejects a missing secret with 503 and a wrong one with 403.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://timesheet.example.com/api/v1/cron/cleanup
```

### Vercel

Vercel terminates TLS and serves HSTS from its own edge; there is no manifest in
this repo for it. The repository's `vercel.json` schedules the same cleanup path
every 15 minutes; Vercel sends the configured `CRON_SECRET` as the Bearer
authorization header. Confirm the deployed header with the same `curl -sSI`
check above and, if it is absent or shorter than a year, set it in the Vercel
project's header configuration rather than in `next.config.ts`.

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
  `native`). `DATABASE_URL`, `AUTH_SECRET`, `RATE_LIMIT_SUBJECT_SECRET`,
  `CRON_SECRET`, the admin credentials, and SMTP recovery settings are runtime
  secrets/configuration.
- `TRUSTED_PROXY_HOPS` in `configmap.yaml` must match the number of proxies in
  front of the pod (`1` for either manifest here; `2` when a CDN/WAF fronts the
  ingress). Without it the app cannot distinguish clients and every unproxied
  request shares a single rate-limit bucket named `direct-client`.
- `CRON_SECRET` gates `POST /api/v1/cron/cleanup`, which expires mobile sessions
  and rate-limit rows. `cronjob.yaml` invokes it every 15 minutes and fails the
  job when the secret is missing or the endpoint does not return 2xx. Keep the
  Deployment and CronJob image tags aligned during each release.
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
