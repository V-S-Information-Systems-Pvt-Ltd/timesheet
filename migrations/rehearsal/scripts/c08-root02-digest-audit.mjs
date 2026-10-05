import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import {isDeepStrictEqual} from 'node:util'
const docker='C:/Users/kasku/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
const before=JSON.parse(readFileSync('C:/Users/kasku/AppData/Local/Temp/vsis-c08-openshift-rehearsal-20261004-worker01/evidence.json','utf8'))
function sql(db,query){const r=spawnSync(docker,['exec','-i','vsis-migration-native','psql','-X','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-At'],{input:query,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('E_READ_AUDIT');return r.stdout.trim()}
function digests(db){const tables=JSON.parse(sql(db,"select coalesce(json_agg(tablename order by tablename),'[]') from pg_tables where schemaname='public';"));return Object.fromEntries(tables.map(table=>{if(!/^[a-z0-9_]+$/.test(table))throw Error('E_IDENTIFIER');const raw=sql(db,`begin isolation level repeatable read read only;set local timezone='UTC';select json_build_object('count',count(*),'digest',md5(coalesce(string_agg(payload,E'\\n' order by payload collate "C"),''))) from(select to_jsonb(t)::text payload from public."${table}" t)s;commit;`);return[table,JSON.parse(raw.split('\n').find(v=>v.startsWith('{')))];}))}
const primary=digests('vsis_migration_destination_20261003'), original=digests('vsis_c08_resume_20261004_141316'), clone=digests('c08_rehearsal_20261004_worker01')
const evidence={observedAt:new Date().toISOString(),primaryUnchanged:isDeepStrictEqual(primary,before.primaryBefore),originalRehearsalUnchanged:isDeepStrictEqual(original,before.originalBefore),disposableCloneUnchanged:isDeepStrictEqual(clone,before.originalBefore),publicTables:Object.keys(primary).length,readOnly:true,enrollmentExecuted:false,timingStarted:false}
if(!evidence.primaryUnchanged||!evidence.originalRehearsalUnchanged||!evidence.disposableCloneUnchanged)throw Error('E_DIGEST_DRIFT')
writeFileSync('docs/plans/evidence/c08-continuation-preservation-2026-10-05.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence))
