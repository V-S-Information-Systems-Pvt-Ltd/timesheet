// scripts/export-supabase-signing-key.mjs
// Reads supabase/signing_keys.json, derives the PEM private key and kid,
// and outputs environment variables or appends them directly to $GITHUB_ENV.

import { createPrivateKey } from 'node:crypto'
import { readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const keyPath = join(process.cwd(), 'supabase', 'signing_keys.json')
const parsed = JSON.parse(readFileSync(keyPath, 'utf8'))
const jwk = Array.isArray(parsed) ? parsed[0] : parsed
const keyObj = createPrivateKey({ format: 'jwk', key: jwk })
const pem = keyObj.export({ type: 'pkcs8', format: 'pem' })
const kid = jwk.kid || 'cce1af9f-bc14-4223-ad8e-30c8d708fce5'
const alg = jwk.alg || 'ES256'

const githubEnv = process.env.GITHUB_ENV
if (githubEnv) {
  appendFileSync(githubEnv, `SUPABASE_MOBILE_SIGNING_KEY_ID=${kid}\n`)
  appendFileSync(githubEnv, `SUPABASE_MOBILE_SIGNING_ALG=${alg}\n`)
  appendFileSync(githubEnv, `SUPABASE_MOBILE_SIGNING_KEY<<EOF\n${pem}\nEOF\n`)
  console.log(`Exported Supabase signing key (${kid}, ${alg}) to GITHUB_ENV`)
} else {
  console.log(`KID=${kid}`)
  console.log(`ALG=${alg}`)
  console.log(`PEM:\n${pem}`)
}
