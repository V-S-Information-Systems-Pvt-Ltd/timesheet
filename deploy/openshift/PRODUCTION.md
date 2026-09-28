# VSIS Timesheet on OpenShift (Supabase backend)

This runbook deploys the Supabase build to project `timesheet-vsis` at
`https://timesheet.apps.ocp4.vsis.lk`. Run commands from the repository root in
PowerShell with an authenticated `oc` context. The checked-in CRC overlay is for
the separate native-backend test environment; do not apply it here.

The deployment needs a working Supabase project and a local `.env.local` with
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SUBJECT_SECRET`, `CRON_SECRET`, and
`SUPER_ADMIN_EMAIL`. Keep `.env.local` out of Git and the binary build context.
The commands below send only the required server secrets to an OpenShift Secret;
they do not deploy `E2E_*` credentials or native-backend secrets.

## 1. Prepare the project and runtime configuration

```powershell
oc create namespace timesheet-vsis
oc annotate namespace timesheet-vsis openshift.io/display-name='VSIS Timesheet Production' --overwrite

node --env-file=.env.local -e "const e=process.env; const keys=['SUPABASE_SERVICE_ROLE_KEY','RATE_LIMIT_SUBJECT_SECRET','CRON_SECRET']; if(keys.some(k=>!e[k]))process.exit(1); process.stdout.write(JSON.stringify({apiVersion:'v1',kind:'Secret',metadata:{name:'vsis-timesheet-secret',namespace:'timesheet-vsis'},type:'Opaque',stringData:Object.fromEntries(keys.map(k=>[k,e[k]]))}))" | oc create -f -

node --env-file=.env.local -e "const e=process.env; const keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPER_ADMIN_EMAIL']; if(keys.some(k=>!e[k]))process.exit(1); process.stdout.write(JSON.stringify({apiVersion:'v1',kind:'ConfigMap',metadata:{name:'vsis-timesheet-config',namespace:'timesheet-vsis'},data:{NEXT_PUBLIC_BACKEND:'supabase',NEXT_PUBLIC_SUPABASE_URL:e.NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:e.NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPER_ADMIN_EMAIL:e.SUPER_ADMIN_EMAIL,APP_BASE_URL:'https://timesheet.apps.ocp4.vsis.lk',TRUSTED_PROXY_HOPS:'1',MOBILE_BEARER_AUTH_ENABLED:'false',DURABLE_IDEMPOTENCY_ENABLED:'false'}}))" | oc create -f -
```

For a repeat deployment, retain existing Secrets. To rotate them, use a
reviewed secret-management workflow and restart the Deployment after the Secret
is replaced. Do not use `oc apply` with plaintext `stringData`: its last-applied
annotation can retain those values.

Mobile bearer auth is disabled here because `.env.local` lacks the Supabase
signing key ID and key. Enable it only after the key is registered in Supabase
and the required server settings are supplied. Durable idempotency remains off
until its migration and RLS evidence are verified.

## 2. Build and pin the image

```powershell
oc apply -k deploy/openshift/build/base -n timesheet-vsis
$public = node --env-file=.env.local -e "process.stdout.write(JSON.stringify({url:process.env.NEXT_PUBLIC_SUPABASE_URL,anon:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}))" | ConvertFrom-Json
$release = 'release-' + (git rev-parse --short HEAD)
$patch = @{spec=@{output=@{to=@{kind='ImageStreamTag';name="vsis-timesheet:$release"}};strategy=@{dockerStrategy=@{dockerfilePath='Dockerfile';buildArgs=@(@{name='NEXT_PUBLIC_SUPABASE_URL';value=$public.url},@{name='NEXT_PUBLIC_SUPABASE_ANON_KEY';value=$public.anon})}}}} | ConvertTo-Json -Depth 10 -Compress
oc patch bc/vsis-timesheet -n timesheet-vsis --type=merge -p $patch
$context = powershell -NoProfile -ExecutionPolicy Bypass -File deploy/openshift/scripts/package-source.ps1 -Backend supabase | ConvertFrom-Json
if ($context.SecretFilenameScan -ne 'passed') { throw 'Unsafe build context' }
oc start-build vsis-timesheet -n timesheet-vsis --from-dir="$($context.ContextDirectory)" --wait
$image = oc get istag "vsis-timesheet:$release" -n timesheet-vsis -o jsonpath='{.image.dockerImageReference}'
if ($image -notmatch '@sha256:[a-f0-9]{64}$') { throw 'Build did not publish a digest' }
```

The build uses `Dockerfile.supabase`, compiles `NEXT_PUBLIC_*` values into the
client bundle, and runs the Supabase Auth configuration gate. It does not receive
the service-role key or other server secrets. Record `$image` as the immutable
release identity. Remove only the temporary context directory created by the
packager after the build has finished.

## 3. Deploy the app and HTTPS Route

```powershell
oc apply -n timesheet-vsis -f deploy/openshift/app/base/serviceaccount.yaml -f deploy/openshift/app/base/service.yaml -f deploy/openshift/app/base/networkpolicy.yaml
oc create route edge vsis-timesheet -n timesheet-vsis --service=vsis-timesheet --hostname=timesheet.apps.ocp4.vsis.lk --port=http --insecure-policy=Redirect
oc annotate route vsis-timesheet -n timesheet-vsis haproxy.router.openshift.io/timeout=180s --overwrite

$deployment = (Get-Content deploy/openshift/app/base/deployment.yaml -Raw).Replace('image: vsis-timesheet:crc', ('image: ' + $image)).Replace('replicas: 1', 'replicas: 2')
$deployment | oc apply -n timesheet-vsis -f -
$cronjob = (Get-Content deploy/openshift/app/base/cronjob.yaml -Raw).Replace('image: vsis-timesheet:crc', ('image: ' + $image))
$cronjob | oc apply -n timesheet-vsis -f -
oc rollout status deployment/vsis-timesheet -n timesheet-vsis --timeout=300s
```

For an existing Route, use `oc get route` and update only the intended fields.
The base `NetworkPolicy` uses OpenShift's ingress policy group so host-network
router pods can reach the application. No native database or seed Job is used
for this Supabase deployment.

The Route currently uses the cluster's default internal-CA certificate. Install
the approved certificate or distribute its CA before relying on browser trust.
HSTS is deliberately omitted until that TLS work is complete.

## 4. Verify and operate

```powershell
oc get deploy,route,cronjob,pods -n timesheet-vsis
oc get deployment vsis-timesheet -n timesheet-vsis -o jsonpath='{.status.readyReplicas}/{.spec.replicas}'
oc exec -n timesheet-vsis deploy/vsis-timesheet -- node -e "fetch('http://vsis-timesheet/api/health').then(async r=>console.log(r.status,await r.text()))"
oc create job vsis-timesheet-cleanup-smoke -n timesheet-vsis --from=cronjob/vsis-timesheet-cleanup
oc wait -n timesheet-vsis --for=condition=complete job/vsis-timesheet-cleanup-smoke --timeout=180s
oc delete job vsis-timesheet-cleanup-smoke -n timesheet-vsis
```

With the internal CA trusted, check the public URL's `/api/health/live`,
`/api/health`, `/api/v1/config`, and root page over HTTPS, and confirm HTTP
redirects to HTTPS. Confirm the image digest and `restricted-v2` SCC on both app
pods. The cleanup CronJob runs every 15 minutes.

For updates, build a new release tag, repeat the digest-pinned Deployment and
CronJob apply, then wait for the rollout and repeat the checks. Keep the prior
digest available for rollback with `oc set image` if needed. Rotate exposed
credentials and update the OpenShift Secret through the approved secret process.
