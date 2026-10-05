import NextEnv from '@next/env'
import { writeFileSync } from 'node:fs'
import { runCli } from '../../tool/src/cli.ts'
NextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}})
const url=new URL(process.env.MIGRATION_SOURCE_DB)
if(!url.hostname.includes('bcsdqkjzobllocejfcdz')&&!url.username.includes('bcsdqkjzobllocejfcdz'))throw Error('E_SOURCE_BINDING')
const output=[],errors=[]
const code=await runCli(['inspect','--source','supabase','--source-env','MIGRATION_SOURCE_DB','--json'],{env:process.env,cwd:process.cwd()+'/migrations/tool',out:line=>output.push(line),err:line=>errors.push(line)})
if(code!==0){console.log(JSON.stringify({sourceInspect:'failed',exitCode:code}));process.exitCode=1}else{
 const raw=JSON.parse(output.join('\n'));const evidence={observedAt:new Date().toISOString(),sourceInspect:'passed',sourceWrites:false,sourceProject:'bcsdqkjzobllocejfcdz',applicationRelease:'1.0.3',applicationReleaseMethod:'Vercel deployment commit and package.json at that commit',provider:raw.provider,namespace:raw.namespace,runtimeFingerprint:raw.runtimeFingerprint,schemaFingerprint:raw.schemaFingerprint,appliedMigrations:raw.appliedMigrations,counts:raw.counts,missingTables:raw.missingTables};
 writeFileSync('docs/plans/evidence/c08-source-requalification-2026-10-05.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
