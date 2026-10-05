// Private HTTP transport: verify the real router CA and requested hostname.
import https from 'node:https'
import { readFileSync, writeFileSync } from 'node:fs'
const path=process.argv[2]
const input=JSON.parse(readFileSync(path,'utf8'))
const request=https.request(input.url,{
  method:input.method,headers:input.headers,ca:readFileSync(input.ca),rejectUnauthorized:true,
  servername:'timesheet.apps-crc.testing',
  lookup:(_hostname,options,callback)=>callback(null,options.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4),
},response=>{
  const authorized=response.socket.authorized
  const chunks=[]
  response.on('data',chunk=>chunks.push(chunk))
  response.on('end',()=>{
    writeFileSync(input.prefix+'-response',Buffer.concat(chunks))
    writeFileSync(input.prefix+'-headers',Object.entries(response.headers).flatMap(([key,value])=>(Array.isArray(value)?value:[value]).map(v=>`${key}: ${v}`)).join('\n'))
    if(!authorized){process.exitCode=1;return}
    process.stdout.write(String(response.statusCode))
  })
})
request.setTimeout(25000,()=>request.destroy(new Error('E_TIMEOUT')))
request.on('error',error=>{process.stderr.write(String(error.code??'E_HTTP'));process.exitCode=1})
if(input.body!==undefined)request.write(input.body)
request.end()
