// Bounded disposable final-host qualification. Never print secrets, records, or mail.
import { spawnSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync, openSync, closeSync, readdirSync, unlinkSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { randomBytes, randomUUID, createHash, createHmac } from 'node:crypto'
import pg from 'pg'

const dir = 'C:/Users/kasku/AppData/Local/Temp/vsis-c08-openshift-rehearsal-20261004-worker01'
const primaryDir = 'C:/Users/kasku/AppData/Local/Temp/vsis-c08-openshift-primary-access-20261004-root01'
const docker = 'C:/Users/kasku/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
const ocExe = 'C:/Users/kasku/.crc/bin/oc/oc.exe'
const kube = 'C:/Users/kasku/.crc/machines/crc/kubeconfig'
const namespace = 'vsis-timesheet', name = 'c08-rehearsal-worker01'
const source = 'vsis_c08_resume_20261004_141316', primary = 'vsis_migration_destination_20261003'
const database = 'c08_rehearsal_20261004_worker01', role = 'c08_rehearsal_worker01'
const container = 'vsis-migration-native', host = 'timesheet.apps-crc.testing', origin = `https://${host}`
const image = 'image-registry.openshift-image-registry.svc:5000/vsis-timesheet/vsis-timesheet@sha256:e3a512e1c6d90b0919d216c901372bae266cf8bd0d7f134759575186352844f1'
const mailImage = 'public.ecr.aws/supabase/mailpit@sha256:37a38e48e9338cd7e89dfeb487f37b02ebfcd9cb23111bed2d345e79d37d6dd6'
const mode = process.argv[2]
const report = mode === 'prepare' ? { namespace, name, database, role, source, primary, dir, image, mailImage, stages: [], tests: [], created: [], status: 'preparing' } : JSON.parse(readFileSync(`${dir}/evidence.json`))
const save = () => writeFileSync(`${dir}/evidence.json`, JSON.stringify(report, null, 2))
const assert = (value, code) => { if (!value) throw new Error(code) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function cmd(exe, args, input) {
  const r = spawnSync(exe, args, { input, windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) { appendFileSync(`${dir}/private-command-errors.log`, r.stderr ?? String(r.error)); throw new Error(`E_COMMAND_${exe.includes('oc.exe') ? 'OC' : exe.includes('docker') ? 'DOCKER' : 'OTHER'}`) }
  return r.stdout
}
const oc = (args, input) => cmd(ocExe, ['--kubeconfig', kube, '-n', namespace, ...args], input).toString().trim()
const dock = (args, input) => cmd(docker, args, input)
const sql = (query, db = database) => dock(['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], query).toString().trim()
const json = (query, db) => JSON.parse(sql(query, db).split('\n').find(line => line.startsWith('{') || line.startsWith('[')))
async function stage(label, fn) {
  try { await fn(); report.stages.push({ name: label, status: 'passed' }); save(); console.log(JSON.stringify({ stage: label, status: 'passed' })) }
  catch (error) { report.stages.push({ name: label, status: 'failed', code: error.message.startsWith('E_') ? error.message : 'E_PRIVATE_DETAIL' }); throw error }
}
function digests(db) {
  const names = JSON.parse(sql("select coalesce(json_agg(tablename order by tablename),'[]') from pg_tables where schemaname='public';", db))
  const result = {}
  for (const table of names) {
    assert(/^[a-z0-9_]+$/.test(table), 'E_IDENTIFIER')
    result[table] = json(`begin isolation level repeatable read read only;set local timezone='UTC';select json_build_object('count',count(*),'digest',md5(coalesce(string_agg(payload,E'\\n' order by payload collate "C"),''))) from(select to_jsonb(t)::text payload from public."${table}" t)s;commit;`, db)
  }
  return result
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const manifestQuery = `select coalesce(json_agg(x order by kind,identity),'[]') from (
 select 'relation' kind,c.relkind::text subtype,format('%I.%I',n.nspname,c.relname) identity,pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','S','v','m','f') and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
 union all select 'routine',p.prokind::text,format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 union all select 'type',t.typtype::text,format('%I.%I',n.nspname,t.typname),pg_get_userbyid(t.typowner) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typrelid=0 and t.typelem=0 and t.typtype in ('d','e','c') and not exists(select 1 from pg_depend d where d.classid='pg_type'::regclass and d.objid=t.oid and d.deptype='e'))x;`
const extensionQuery = "select coalesce(json_agg(x order by identity),'[]') from(select pg_describe_object(d.classid,d.objid,d.objsubid) identity,e.extname from pg_depend d join pg_extension e on e.oid=d.refobjid where d.refclassid='pg_extension'::regclass and d.deptype='e')x;"
function ownershipSql(manifest) {
  return `revoke create on schema public from public;grant usage,create on schema public to "${role}";\n` + manifest.map(o => {
    const kind = o.kind === 'relation' ? { r:'TABLE', p:'TABLE', S:'SEQUENCE', v:'VIEW', m:'MATERIALIZED VIEW', f:'FOREIGN TABLE' }[o.subtype] : o.kind === 'routine' ? (o.subtype === 'p' ? 'PROCEDURE' : 'FUNCTION') : 'TYPE'
    assert(kind && o.identity.startsWith('public.'), 'E_MANIFEST_SCOPE')
    return `alter ${kind} ${o.identity} owner to "${role}";`
  }).join('\n')
}
function create(resource) {
  if (report.created.some(item=>item.kind===resource.kind&&item.name===resource.metadata.name)) return
  const result = JSON.parse(oc(['create', '-f', '-', '-o', 'json'], JSON.stringify(resource)))
  report.created.push({ kind: result.kind, name: result.metadata.name, uid: result.metadata.uid }); save()
}
function resource(kind, suffix, body) { return { apiVersion: ({Deployment:'apps/v1',Route:'route.openshift.io/v1',NetworkPolicy:'networking.k8s.io/v1'})[kind] ?? 'v1', kind, metadata:{ name:name+suffix,namespace,labels:{'vsis.c08.owner':name}}, ...body } }
async function prepare() {
  await stage('read-only-primary-original-snapshots-and-disposable-restore', async () => {
    assert(sql(`select count(*) from pg_database where datname='${database}';`, 'postgres') === '0', 'E_DATABASE_EXISTS')
    assert(sql(`select count(*) from pg_roles where rolname='${role}';`, 'postgres') === '0', 'E_ROLE_EXISTS')
    report.primaryBefore = digests(primary); report.originalBefore = digests(source)
    assert(report.originalBefore.profiles.count === 23 && report.originalBefore.timesheets.count === 854 && report.originalBefore.projects.count === 47, 'E_SOURCE_COUNTS')
    const dump = dock(['exec', container, 'pg_dump', '-U', 'postgres', '-d', source, '-Fc', '--no-owner', '--no-acl'])
    writeFileSync(`${dir}/original-qualified-clone.dump`, dump, {flag:'wx'})
    report.dumpSha256 = createHash('sha256').update(dump).digest('hex')
    sql(`create database "${database}" template template0;`, 'postgres')
    dock(['exec','-i',container,'pg_restore','-U','postgres','-d',database,'--no-owner','--no-acl','--exit-on-error'],dump)
    assert(equal(digests(database), report.originalBefore), 'E_RESTORE_PARITY')
    assert(sql('select state from public.migration_write_gate;') === 'open', 'E_CLONE_GATE_NOT_OPEN')
    // No migration-tool control, export/apply/import, or admission is invoked.
    report.cloneGate = 'restored already-open disposable gate; no gate mutation'
  })
  await stage('explicit-clone-only-ownership-and-scram', async () => {
    const manifest = JSON.parse(sql(manifestQuery)), extensionBefore = sql(extensionQuery)
    writeFileSync(`${dir}/ownership-before.json`,JSON.stringify(manifest,null,2))
    const password = randomBytes(32).toString('hex')
    writeFileSync(`${dir}/runtime-password`,password,{flag:'wx'})
    const ownership = ownershipSql(manifest)
    writeFileSync(`${dir}/ownership-apply.sql`,ownership,{flag:'wx'})
    sql(`begin;set local password_encryption='scram-sha-256';create role "${role}" login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}';revoke connect,temporary on database "${database}" from public;grant connect on database "${database}" to "${role}";${ownership}commit;`)
    const after = JSON.parse(sql(manifestQuery)); assert(after.every(o => o.owner === role),'E_OWNERSHIP'); assert(sql(extensionQuery) === extensionBefore,'E_EXTENSION_MEMBERS')
    report.ownedObjects = after.length
    report.roleFlags = json(`select row_to_json(r) from(select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolpassword like 'SCRAM-SHA-256$%' scram,(select count(*) from pg_auth_members where member=pg_authid.oid) memberships from pg_authid where rolname='${role}')r;`)
    assert(Object.entries(report.roleFlags).every(([key,value]) => key === 'scram' ? value : key === 'memberships' ? value === 0 : value === false),'E_ROLE_FLAGS')
    const before = dock(['exec',container,'cat','/var/lib/postgresql/data/pg_hba.conf']).toString()
    writeFileSync(`${dir}/pg_hba-before.conf`, before, {flag:'wx'})
    const position = before.indexOf('host all all 0.0.0.0/0 reject')
    assert(position >= 0 && !before.includes(database),'E_HBA_LAYOUT')
    const rules = `hostssl ${database} ${role} 0.0.0.0/0 scram-sha-256\nhostssl ${database} ${role} ::/0 scram-sha-256\n`
    const updated = before.slice(0,position) + rules + before.slice(position)
    writeFileSync(`${dir}/pg_hba-after.conf`,updated)
    assert(dock(['exec',container,'cat','/var/lib/postgresql/data/pg_hba.conf']).toString() === before,'E_HBA_CONCURRENT_DRIFT')
    dock(['exec','-i',container,'sh','-c','cat > /var/lib/postgresql/data/pg_hba.c08-worker01.conf && chown postgres:postgres /var/lib/postgresql/data/pg_hba.c08-worker01.conf && chmod 600 /var/lib/postgresql/data/pg_hba.c08-worker01.conf'], updated)
    // pg_hba_file_rules parses the on-disk file before reload changes live authentication.
    dock(['exec',container,'mv','/var/lib/postgresql/data/pg_hba.c08-worker01.conf','/var/lib/postgresql/data/pg_hba.conf'])
    if (sql('select count(*) from pg_hba_file_rules where error is not null;') !== '0') {
      dock(['exec','-i',container,'sh','-c','cat > /var/lib/postgresql/data/pg_hba.conf && chown postgres:postgres /var/lib/postgresql/data/pg_hba.conf && chmod 600 /var/lib/postgresql/data/pg_hba.conf'],before)
      throw new Error('E_HBA_VALIDATION_ROLLED_BACK')
    }
    assert(sql('select pg_reload_conf();')==='t','E_RELOAD'); await sleep(1000)
    const runtime = new URL(`postgresql://localhost:5432/${database}`);runtime.username=role;runtime.password=password;runtime.searchParams.set('sslmode','verify-full');runtime.searchParams.set('sslrootcert',`${primaryDir}/ca.crt`)
    writeFileSync(`${dir}/runtime-url`,runtime.href,{flag:'wx'})
    const client = new pg.Client({connectionString:runtime.href});await client.connect()
    try { assert(client.connection.stream.authorized,'E_LOCAL_TLS');await client.query('select 1');report.localTLS=true } finally {await client.end()}
    assert(equal(digests(primary),report.primaryBefore),'E_PRIMARY_DRIFT');assert(equal(digests(source),report.originalBefore),'E_ORIGINAL_DRIFT')
  })
  report.status='clone-prepared'
}

async function deploy() {
  await stage('immutable-image-private-runtime-and-local-mail-resources',async()=>{
    const labels = app => ({'app':`${name}-${app}`,'vsis.c08.owner':name})
    const env = {NEXT_PUBLIC_BACKEND:'native',APP_BASE_URL:origin,TRUSTED_PROXY_HOPS:'1',HOSTNAME:'0.0.0.0',PORT:'3000',HEALTH_DEBUG:'true',DB_POOL_MAX:'3',NEXT_TELEMETRY_DISABLED:'1',SMTP_HOST:`${name}-mail`,SMTP_PORT:'1025',SMTP_SECURE:'false',SMTP_FROM:'VSIS C08 <no-reply@c08.invalid>',MOBILE_BEARER_AUTH_ENABLED:'false'}
    const runtime = new URL(readFileSync(`${dir}/runtime-url`,'utf8'));runtime.hostname='host.crc.testing';runtime.searchParams.set('sslrootcert','/run/c08/ca.crt')
    const secrets = {DATABASE_URL:runtime.href,AUTH_SECRET:randomBytes(48).toString('hex'),RATE_LIMIT_SUBJECT_SECRET:randomBytes(48).toString('hex'),CRON_SECRET:randomBytes(48).toString('hex')}
    writeFileSync(`${dir}/runtime-secrets.json`,JSON.stringify(secrets),{flag:'wx'})
    create(resource('Secret','-runtime',{type:'Opaque',stringData:secrets}))
    create(resource('ConfigMap','-ca',{data:{'ca.crt':readFileSync(`${primaryDir}/ca.crt`,'utf8')}}))
    const securityContext={runAsNonRoot:true,seccompProfile:{type:'RuntimeDefault'}}
    const containerSecurity={allowPrivilegeEscalation:false,capabilities:{drop:['ALL']},readOnlyRootFilesystem:true}
    const deployment=(suffix,app,c)=>resource('Deployment',suffix,{spec:{replicas:1,selector:{matchLabels:{app:`${name}-${app}`}},template:{metadata:{labels:labels(app)},spec:{automountServiceAccountToken:false,securityContext,containers:[c],volumes:app==='app'?[{name:'ca',configMap:{name:`${name}-ca`,defaultMode:292}},{name:'tmp',emptyDir:{sizeLimit:'32Mi'}}]:[{name:'mail',emptyDir:{sizeLimit:'64Mi'}},{name:'tmp',emptyDir:{sizeLimit:'8Mi'}}]}}}})
    create(deployment('-mail','mail',{name:'mail',image:mailImage,ports:[{name:'smtp',containerPort:1025},{name:'http',containerPort:8025}],env:[{name:'MP_DATABASE',value:'/data/mailpit.db'},{name:'MP_MAX_MESSAGES',value:'10'},{name:'MP_SMTP_BIND_ADDR',value:'0.0.0.0:1025'},{name:'MP_UI_BIND_ADDR',value:'0.0.0.0:8025'},{name:'MP_DISABLE_VERSION_CHECK',value:'true'}],securityContext:containerSecurity,volumeMounts:[{name:'mail',mountPath:'/data'},{name:'tmp',mountPath:'/tmp'}],resources:{requests:{cpu:'25m',memory:'64Mi'},limits:{cpu:'250m',memory:'192Mi'}},readinessProbe:{httpGet:{path:'/livez',port:8025},initialDelaySeconds:3,periodSeconds:5}}))
    create(resource('Service','-mail',{spec:{selector:{app:`${name}-mail`},ports:[{name:'smtp',port:1025,targetPort:1025},{name:'http',port:8025,targetPort:8025}]}}))
    create(resource('NetworkPolicy','-mail-isolation',{spec:{podSelector:{matchLabels:{app:`${name}-mail`}},policyTypes:['Ingress','Egress'],ingress:[{from:[{podSelector:{matchLabels:{app:`${name}-app`}}}],ports:[{protocol:'TCP',port:1025}]}],egress:[]}}))
    create(deployment('-app','app',{name:'app',image,ports:[{name:'http',containerPort:3000}],env:Object.entries(env).map(([name,value])=>({name,value})),envFrom:[{secretRef:{name:`${name}-runtime`}}],securityContext:containerSecurity,volumeMounts:[{name:'ca',mountPath:'/run/c08',readOnly:true},{name:'tmp',mountPath:'/tmp'}],resources:{requests:{cpu:'100m',memory:'256Mi'},limits:{cpu:'750m',memory:'512Mi'}},readinessProbe:{httpGet:{path:'/api/health',port:3000},initialDelaySeconds:5,periodSeconds:5},livenessProbe:{httpGet:{path:'/api/health/live',port:3000},initialDelaySeconds:20,periodSeconds:20}}))
    create(resource('Service','-app',{spec:{selector:{app:`${name}-app`},ports:[{name:'http',port:3000,targetPort:3000}]}}))
    create(resource('Route','-route',{spec:{host,to:{kind:'Service',name:`${name}-app`},port:{targetPort:'http'},tls:{termination:'edge',insecureEdgeTerminationPolicy:'Redirect'}}}))
    // Limit app ingress to the actual OpenShift ingress router. Database egress is narrowed after live DNS resolution.
    create(resource('NetworkPolicy','-app-isolation',{spec:{podSelector:{matchLabels:{app:`${name}-app`}},policyTypes:['Ingress'],ingress:[{from:[{namespaceSelector:{matchLabels:{'network.openshift.io/policy-group':'ingress'}}}],ports:[{protocol:'TCP',port:3000}]}]}}))
    const ca=JSON.parse(oc(['get','secret','router-ca','-n','openshift-ingress-operator','-o','json'])).data['tls.crt']
    writeFileSync(`${dir}/router-ca.crt`,Buffer.from(ca,'base64'),{flag:'wx'})
    report.routerCaSha256=createHash('sha256').update(Buffer.from(ca,'base64')).digest('hex')
    report.configuration={APP_BASE_URL:origin,TRUSTED_PROXY_HOPS:1,untrustedClientIpOptIn:false,mailNoExternalRelay:true,cronDeployed:false,primaryAppDeployed:false}
  })
  report.status='deployed'
}

async function inspect() {
  await stage('actual-new-image-uid-security-source-and-tls',async()=>{
    const pods=JSON.parse(oc(['get','pods','-l',`app=${name}-app`,'-o','json'])).items
    assert(pods.length===1,'E_POD_COUNT');const pod=pods[0];report.pod=pod.metadata.name
    assert(pod.status.containerStatuses?.[0]?.ready,'E_APP_NOT_READY')
    assert(pod.status.containerStatuses[0].imageID.endsWith(image.split('@')[1]),'E_IMAGE_DIGEST')
    const appEvidence=JSON.parse(oc(['exec',report.pod,'--','node','-e',`const fs=require('fs'),crypto=require('crypto');console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),node:process.version,pg:require('pg/package.json').version,buildId:fs.readFileSync('.next/BUILD_ID','utf8').trim(),serverSha256:crypto.createHash('sha256').update(fs.readFileSync('server.js')).digest('hex'),caReadable:fs.statSync('/run/c08/ca.crt').size>0,tokenMounted:fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount/token')}))`]))
    assert(appEvidence.uid>=1000650000&&appEvidence.uid<1000660000&&!appEvidence.tokenMounted&&appEvidence.caReadable,'E_SECURITY_CONTEXT')
    assert(appEvidence.buildId==='BwTJAq7EalV6qaTNlGBFg'&&appEvidence.serverSha256==='193ada325ff83fe1354f11a807b6f77b77ce2c5f06ec5b47a9dbdb19b51e3b6d','E_SOURCE_IDENTITY')
    assert(pod.spec.securityContext.seccompProfile?.type==='RuntimeDefault'&&pod.spec.containers[0].securityContext.runAsNonRoot!==false,'E_SECCOMP')
    report.appEvidence=appEvidence
    const dnsEvidence=JSON.parse(oc(['exec',report.pod,'--','node','-e',`require('dns').lookup('host.crc.testing',{all:true},(e,a)=>{if(e)process.exit(1);console.log(JSON.stringify(a))})`]))
    report.pgAddresses=dnsEvidence.map(x=>x.address);assert(dnsEvidence.every(x=>x.family===4),'E_PG_DNS')
    create(resource('NetworkPolicy','-app-egress',{spec:{podSelector:{matchLabels:{app:`${name}-app`}},policyTypes:['Egress'],egress:[{to:report.pgAddresses.map(ip=>({ipBlock:{cidr:ip+'/32'}})),ports:[{protocol:'TCP',port:5432}]},{to:[{podSelector:{matchLabels:{app:`${name}-mail`}}}],ports:[{protocol:'TCP',port:1025}]},{to:[{namespaceSelector:{matchLabels:{'kubernetes.io/metadata.name':'openshift-dns'}}}],ports:[{protocol:'UDP',port:5353},{protocol:'TCP',port:5353},{protocol:'UDP',port:53},{protocol:'TCP',port:53}]}]}}))
    const tlsEvidence=JSON.parse(oc(['exec',report.pod,'--','node','-e',`const{Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query('select current_user,current_database(),ssl,version,cipher from pg_stat_ssl where pid=pg_backend_pid()')).then(r=>{console.log(JSON.stringify({session:r.rows[0],authorized:c.connection.stream.authorized,hostname:c.connectionParameters.host}));return c.end()}).catch(()=>process.exit(1))`]))
    assert(tlsEvidence.authorized&&tlsEvidence.session.ssl&&tlsEvidence.session.current_database===database&&tlsEvidence.session.current_user===role&&tlsEvidence.hostname==='host.crc.testing','E_POD_TLS')
    report.podTLS=tlsEvidence
    const mpods=JSON.parse(oc(['get','pods','-l',`app=${name}-mail`,'-o','json'])).items;assert(mpods.length===1&&mpods[0].status.containerStatuses?.[0]?.ready,'E_MAIL_NOT_READY');report.mailPod=mpods[0].metadata.name
    report.mailSecurity={uid:mpods[0].spec.containers[0].securityContext.runAsUser,seccomp:mpods[0].spec.securityContext.seccompProfile.type,serviceAccountToken:mpods[0].spec.automountServiceAccountToken,emptyDir:true,imageID:mpods[0].status.containerStatuses[0].imageID}
    assert(report.mailSecurity.uid===appEvidence.uid&&!report.mailSecurity.serviceAccountToken,'E_MAIL_SECURITY')
  })
  report.status='runtime-qualified'
}

let requestNumber=0, cookie
function http(label,path,{method='GET',body,headers={}}={}) {
  const prefix=`${dir}/http-${++requestNumber}-${label}`
  const quote=value=>JSON.stringify(value)
  const config=[`url = ${quote(origin+path)}`,`request = ${quote(method)}`,`resolve = ${quote(host+':443:127.0.0.1')}`,`cacert = ${quote(dir+'/router-ca.crt')}`,'silent','show-error','max-time = 25',`header = "Origin: ${origin}"`]
  for(const [key,value] of Object.entries(headers))config.push(`header = ${quote(key+': '+value)}`)
  if(cookie)config.push(`header = ${quote('Cookie: '+cookie)}`)
  if(body!==undefined){writeFileSync(prefix+'-request.json',JSON.stringify(body));config.push('header = "Content-Type: application/json"',`data-binary = ${quote('@'+prefix+'-request.json')}`)}
  writeFileSync(prefix+'-curl.conf',config.join('\n'))
  const privateRequest={url:origin+path,method,ca:dir+'/router-ca.crt',prefix,headers:{Origin:origin,...headers,...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}
  writeFileSync(prefix+'-transport.json',JSON.stringify(privateRequest))
  const status=Number(cmd(process.execPath,['migrations/rehearsal/scripts/c08-openshift-enrollment-http-root02.mjs',prefix+'-transport.json']).toString())
  const raw=readFileSync(prefix+'-response','utf8'), responseHeaders=readFileSync(prefix+'-headers','utf8')
  let data;try{data=JSON.parse(raw)}catch{}
  report.tests.push({name:label,status});save()
  return {status,data,raw,cookie:/^set-cookie:\s*([^\r\n]+)/im.exec(responseHeaders)?.[1]}
}
async function smoke() {
  let forward,fd,client
  try {
    await stage('router-ca-verified-final-host-health-and-render',async()=>{
      const health=http('health','/api/health');assert(health.status===200&&health.data.backend==='native'&&health.data.version==='1.1.6','E_ROUTE_HEALTH')
      const login=http('login-render','/');assert(login.status===200&&login.raw.includes('<html'),'E_LOGIN_RENDER')
      const reset=http('reset-render','/reset-password');assert(reset.status===200&&reset.raw.includes('<html'),'E_RESET_RENDER')
      report.routeTLS={hostname:host,resolvedTo:'127.0.0.1',CA:'actual router CA',verificationEnabled:true,version:health.data.version,backend:health.data.backend}
    })
    fd=openSync(`${dir}/private-mail-portforward.log`,'w')
    forward=spawn(ocExe,['--kubeconfig',kube,'-n',namespace,'port-forward',`pod/${report.mailPod}`,'--address','127.0.0.1','18025:8025'],{windowsHide:true,stdio:['ignore',fd,fd]})
    report.ownedPortForwardPid=forward.pid;save()
    for(let i=0;i<30;i++){assert(forward.exitCode===null,'E_FORWARD_EXIT');try{const r=await fetch('http://127.0.0.1:18025/api/v1/messages');if(r.ok)break}catch{}await sleep(500)}
    client=new pg.Client({connectionString:readFileSync(`${dir}/runtime-url`,'utf8')});await client.connect()
    const selected=(await client.query("select id,email from public.profiles where is_active and email is not null and password_hash is null order by(permission_role='admin')desc,id limit 1")).rows[0]
    assert(selected,'E_NO_PASSWORDLESS_USER'); report.passwordlessEnrollment={beforePasswordHashNull:true,accountActive:true,localCaptureOnly:true}; save()
    const password=`C08!${randomBytes(24).toString('base64url')}aA9`
    writeFileSync(`${dir}/private-smoke-credentials.json`,JSON.stringify({id:selected.id,email:selected.email,password}))
    await stage('captured-final-host-reset-single-use-fresh-login-and-normal-migration-init',async()=>{
      const bad=http('wrong-login','/api/v1/auth/browser/login',{method:'POST',body:{email:selected.email,password}});assert(bad.status===401,'E_BAD_LOGIN')
      const reset=http('forgot-password','/api/v1/auth/browser/forgot-password',{method:'POST',body:{email:selected.email},headers:{'X-Forwarded-For':'198.51.100.42'}});assert(reset.status===200,'E_FORGOT')
      let messages
      for(let i=0;i<30;i++){messages=await(await fetch('http://127.0.0.1:18025/api/v1/messages')).json();if(messages.messages?.length)break;await sleep(500)}
      assert(messages?.messages?.length===1,'E_CAPTURE_COUNT')
      const message=await(await fetch(`http://127.0.0.1:18025/api/v1/message/${messages.messages[0].ID}`)).json()
      writeFileSync(`${dir}/private-captured-message.json`,JSON.stringify(message))
      assert(message.To?.some(x=>x.Address?.toLowerCase()===selected.email.toLowerCase()),'E_CAPTURE_RECIPIENT'); const content=String(message.Text??'')+'\n'+String(message.HTML??'')
      assert(content.includes(`${origin}/reset-password#token=`),'E_FINAL_HOST_RESET_URL')
      const token=/token=([A-Za-z0-9_-]{32,256})/.exec(content)?.[1];assert(token,'E_RESET_TOKEN')
      const done=http('reset-password','/api/v1/auth/browser/reset-password',{method:'POST',body:{token,newPassword:password}});assert(done.status===200,'E_RESET')
      const reused=http('reset-reuse','/api/v1/auth/browser/reset-password',{method:'POST',body:{token,newPassword:password}});assert(reused.status===400,'E_REUSE')
      const login=http('fresh-login','/api/v1/auth/browser/login',{method:'POST',body:{email:selected.email,password}});assert(login.status===200&&login.cookie?.includes('vsis_session='),'E_FRESH_LOGIN');cookie=login.cookie.split(';')[0]
      const me=http('me','/api/v1/auth/browser/me');assert(me.status===200&&me.data.user.id===selected.id,'E_FRESH_SESSION')
      const dashboard=http('dashboard-render','/dashboard');assert(dashboard.status===200&&dashboard.raw.includes('<html'),'E_DASHBOARD_RENDER')
      report.normalMigrationInit={normalAppFacade:true,ledgerUnchanged:equal(digests(database).schema_migrations,report.originalBefore.schema_migrations),pendingMigrations:0,sourceAlready0038:true}
      assert(report.normalMigrationInit.ledgerUnchanged,'E_MIGRATION_LEDGER')
      assert((await client.query('select password_hash is not null as present from public.profiles where id=$1',[selected.id])).rows[0].present,'E_PASSWORD_NOT_INSTALLED'); report.passwordlessEnrollment.completed=true; report.passwordlessEnrollment.freshLogin=true; report.passwordlessEnrollment.reuseRejected=true; report.reset={capturedMessages:1,finalHostLink:true,singleUse:true,freshLogin:true,externalDelivery:false}
      // A client-injected forwarded address must not become the last trusted hop.
      const key=JSON.parse(readFileSync(`${dir}/runtime-secrets.json`)).RATE_LIMIT_SUBJECT_SECRET
      const bucket='password-reset-complete'
      const hash=ip=>createHmac('sha256',key).update(bucket+'\0'+bucket+':'+ip).digest('hex').slice(0,32)
      const rows=(await client.query('select subject_hash from public.rate_limits where bucket=$1',[bucket])).rows
      const candidates=['127.0.0.1','192.168.127.1',...report.pgAddresses]
      const matched=candidates.find(ip=>rows.some(r=>r.subject_hash===hash(ip)))
      assert(matched&&!rows.some(r=>r.subject_hash===hash('direct-client')),'E_ROUTER_IP_EVIDENCE')
      const fingerprint=createHash('sha256').update(selected.email.trim().toLowerCase()).digest('hex').slice(0,16)
      const requestBucket='password-reset-request'
      const requestHash=ip=>createHmac('sha256',key).update(requestBucket+'\0'+requestBucket+':'+fingerprint+':'+ip).digest('hex').slice(0,32)
      const requestRows=(await client.query('select subject_hash from public.rate_limits where bucket=$1',[requestBucket])).rows
      report.proxy={trustedHops:1,directClientBucket:false,actualLastHopMatched:matched,injectedAddressIgnored:!requestRows.some(r=>r.subject_hash===requestHash('198.51.100.42')),normalResetBucketMatched:requestRows.some(r=>r.subject_hash===requestHash(matched))}
      assert(report.proxy.injectedAddressIgnored&&report.proxy.normalResetBucketMatched,'E_FORWARDED_SPOOF')
    })
    await stage('restored-backup-http-business-smoke-and-imported-history-review',async()=>{
      const project=(await client.query('select id from public.projects order by id limit 1')).rows[0]
      const activity=(await client.query('select id from public.activity_types where is_active order by id limit 1')).rows[0]
      const logDate='1999-12-29', marker=`C08-final-host-${randomUUID()}`
      assert(Number((await client.query('select count(*) from public.timesheets where user_id=$1 and log_date=$2',[selected.id,logDate])).rows[0].count)===0,'E_SMOKE_DATE')
      const baseline=Number((await client.query('select count(*) from public.timesheets')).rows[0].count)
      const body={projectId:project.id,activityTypeId:activity.id,logDate,hoursWorked:1,workDone:marker},key=randomUUID()
      const created=http('create','/api/v1/timesheets',{method:'POST',body,headers:{'Idempotency-Key':key}});assert(created.status===201,'E_CREATE')
      const owned=(await client.query('select id from public.timesheets where user_id=$1 and work_done=$2',[selected.id,marker])).rows;assert(owned.length===1,'E_OWNED_ROW');report.ownedTimesheetId=owned[0].id;save()
      const id=owned[0].id
      const replay=http('create-replay','/api/v1/timesheets',{method:'POST',body,headers:{'Idempotency-Key':key}});assert(replay.status===201&&Number((await client.query('select count(*) from public.timesheets where work_done=$1',[marker])).rows[0].count)===1,'E_CREATE_REPLAY')
      const keyed=http('keyed-edit-review',`/api/v1/timesheets/${id}`,{method:'PUT',body:{...body,hoursWorked:2},headers:{'Idempotency-Key':randomUUID()}});assert(keyed.status===409&&keyed.data.error?.code==='IDEMPOTENCY_REVIEW_REQUIRED','E_IMPORTED_HISTORY_REVIEW')
      assert(Number((await client.query('select hours_worked from public.timesheets where id=$1',[id])).rows[0].hours_worked)===1,'E_REVIEW_NO_MUTATION')
      const edit=http('edit',`/api/v1/timesheets/${id}`,{method:'PUT',body:{...body,hoursWorked:2}});assert(edit.status===200,'E_EDIT')
      const path=`/api/v1/reports?from=${logDate}&to=${logDate}&userId=${selected.id}&groupBy=user`
      const total=r=>Number(r.data?.data?.grandTotal??r.data?.data?.totalHours??r.data?.data?.total)
      const totals=http('report',path);assert(totals.status===200&&total(totals)===2,'E_REPORT')
      const invalid=http('invalid-hours','/api/v1/timesheets',{method:'POST',body:{...body,hoursWorked:25}});assert(invalid.status===400&&Number((await client.query('select count(*) from public.timesheets')).rows[0].count)===baseline+1,'E_INVALID_MUTATION')
      const deleted=http('delete',`/api/v1/timesheets/${id}`,{method:'DELETE'});assert(deleted.status===200,'E_DELETE')
      const after=http('report-after-delete',path);assert(after.status===200&&total(after)===0,'E_REPORT_CLEANUP')
      assert(Number((await client.query('select count(*) from public.timesheets')).rows[0].count)===baseline,'E_COUNTS_CLEANUP')
      report.business={scope:'restored-backup host functional qualification; no fresh target-bound admission',create:true,createReplay:true,edit:true,reportHours:2,invalidHoursStatus:400,delete:true,reportAfterDelete:0,keyedImportedHistoryReview:{status:409,code:'IDEMPOTENCY_REVIEW_REQUIRED',noMutation:true,queuedReplayCertified:false}}
    })
    await stage('private-mail-delete-and-original-primary-row-audit',async()=>{
      const deleted=await fetch('http://127.0.0.1:18025/api/v1/messages',{method:'DELETE'});assert(deleted.ok,'E_MAIL_DELETE')
      const empty=await(await fetch('http://127.0.0.1:18025/api/v1/messages')).json();assert(empty.messages?.length===0,'E_MAIL_EMPTY');report.ephemeralMessagesDeleted=true
      report.primaryAfter=digests(primary);report.originalAfter=digests(source)
      assert(equal(report.primaryBefore,report.primaryAfter),'E_PRIMARY_AFTER');assert(equal(report.originalBefore,report.originalAfter),'E_ORIGINAL_AFTER')
    })
    report.status='host-functionally-qualified'
  } finally {
    if(client)await client.end().catch(()=>{})
    if(forward){forward.kill();await new Promise(resolve=>{if(forward.exitCode!==null||forward.signalCode!==null)return resolve();forward.once('exit',resolve);setTimeout(resolve,5000)});report.portForwardStopped=forward.exitCode!==null||forward.signalCode!==null}
    if(fd!==undefined)closeSync(fd)
    save()
  }
}

async function cleanup() {
  await stage('scale-owned-workloads-zero-and-restore-clone-test-effects',async()=>{
    oc(['scale',`deployment/${name}-app`,`deployment/${name}-mail`,'--replicas=0'])
    for(let i=0;i<30;i++){const pods=JSON.parse(oc(['get','pods','-l',`vsis.c08.owner=${name}`,'-o','json'])).items;if(pods.length===0)break;await sleep(1000)}
    assert(JSON.parse(oc(['get','pods','-l',`vsis.c08.owner=${name}`,'-o','json'])).items.length===0,'E_PODS_REMAIN')
    assert(sql(`select count(*) from pg_stat_activity where datname='${database}';`,'postgres')==='0','E_CLONE_ACTIVE_CONNECTIONS')
    // Restore only the owned disposable database, removing password, audit, rate-limit and retry smoke effects.
    dock(['exec','-i',container,'pg_restore','-U','postgres','-d',database,'--clean','--if-exists','--no-owner','--no-acl','--exit-on-error'],readFileSync(`${dir}/original-qualified-clone.dump`))
    sql(readFileSync(`${dir}/ownership-apply.sql`,'utf8'))
    report.cloneAfter=digests(database);assert(equal(report.cloneAfter,report.originalBefore),'E_CLONE_FINAL_PARITY')
    assert(JSON.parse(sql(manifestQuery)).every(o=>o.owner===role),'E_CLONE_OWNER_AFTER')
    report.primaryAfter=digests(primary);report.originalAfter=digests(source)
    assert(equal(report.primaryAfter,report.primaryBefore)&&equal(report.originalAfter,report.originalBefore),'E_PRESERVED_FINAL_DIGESTS')
    report.cleanup={appReplicas:0,mailReplicas:0,podsRemaining:0,mailEmptyDirDestroyed:true,allCloneTestEffectsRemoved:true,cloneMatchesAllOriginalTables:true,primaryUnchangedTables:Object.keys(report.primaryBefore).length,originalUnchangedTables:Object.keys(report.originalBefore).length}
    const hba=dock(['exec',container,'cat','/var/lib/postgresql/data/pg_hba.conf']).toString()
    const rules=`hostssl ${database} ${role} 0.0.0.0/0 scram-sha-256\nhostssl ${database} ${role} ::/0 scram-sha-256\n`
    const timingRules='# C08 root03 begin\nhostssl c08_timing_20261005_root03 c08_timing_root03 0.0.0.0/0 scram-sha-256\nhostssl c08_timing_20261005_root03 c08_timing_root03 ::/0 scram-sha-256\n# C08 root03 end\n'
    assert(hba.replace(rules,'').replace(timingRules,'')===readFileSync(`${dir}/pg_hba-before.conf`,'utf8'),'E_PRIMARY_AUTH_CONFIG_DRIFT')
    const primaryClient=new pg.Client({connectionString:readFileSync(`${primaryDir}/runtime-url`,'utf8')});await primaryClient.connect()
    try {assert(primaryClient.connection.stream.authorized,'E_PRIMARY_TLS_FINAL');await primaryClient.query('begin read only');await primaryClient.query('select 1');await primaryClient.query('rollback');report.cleanup.primaryAuthenticationPreserved=true}finally{await primaryClient.end()}
    const imageObject=JSON.parse(oc(['get','image',image.split('@')[1],'-o','json']))
    const metadata=typeof imageObject.dockerImageMetadata==='string'?JSON.parse(imageObject.dockerImageMetadata):imageObject.dockerImageMetadata
    report.imageConfiguredUser=metadata.Config?.User??metadata.config?.User??metadata.config?.User
    assert(report.imageConfiguredUser==='1001','E_IMAGE_NUMERIC_USER')
    let removed=0
    for(const file of readdirSync(dir)){
      if(!file.startsWith('http-')&&!['private-captured-message.json','private-smoke-credentials.json','private-mail-portforward.log'].includes(file))continue
      const path=resolve(dir,file),rel=relative(resolve(dir),path)
      assert(rel&&!rel.startsWith('..')&&!rel.includes('\\')&&!rel.includes('/'),'E_ARTIFACT_SCOPE')
      unlinkSync(path);removed++
    }
    report.cleanup.privateRequestAndMessageArtifactsRemoved=removed
    report.unresolvedGates=['Fresh source data was not requalified','Fresh primary-target-bound final plan/import/admission remains outstanding','External SMTP delivery was not exercised; local capture only','Production cutover approval remains outstanding','New-platform freeze-window and recovery timing fit was not measured']
  })
  report.status=report.business?'qualified-stopped':'stopped-with-unresolved-checks'
}

try {
  if (mode === 'prepare') await prepare()
  else if (mode === 'deploy') await deploy()
  else if (mode === 'inspect') await inspect()
  else if (mode === 'smoke') await smoke()
  else if (mode === 'cleanup') await cleanup()
  else throw new Error('E_UNKNOWN_MODE')
  save()
} catch(error) {
  appendFileSync(`${dir}/private-errors.log`, `${error.stack ?? error}\n`)
  report.status='failed';report.errorCode=error.message.startsWith('E_')?error.message:'E_PRIVATE_DETAIL';save()
  console.log(JSON.stringify({status:report.status,code:report.errorCode,dir}));process.exitCode=1
}
