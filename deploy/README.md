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
   `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
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
  `native`). `DATABASE_URL`, `AUTH_SECRET`, and the admin credentials are
  runtime secrets.
- OpenShift runs pods as an arbitrary UID; the image is non-root and does not
  write to the filesystem, so it runs unmodified. Use `deploy/route.yaml` for
  OpenShift, or an Ingress for Rancher.
- For local development against a container, use `docker compose up` from the
  repo root (see `docker-compose.yml`).
