#!/usr/bin/env node
// Read-only logical exports using the same installed CLI as `npx supabase`.
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, realpath, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEFAULT_OUTPUT_DIRECTORY = 'C:\\dev\\db-backup'
export const LIVE_PROJECT_REF = 'bcsdqkjzobllocejfcdz'
const REPO_DIRECTORY = fileURLToPath(new URL('..', import.meta.url))
const EXPORTS = [
  { name: 'roles.sql', flags: ['--role-only'] },
  { name: 'schema.sql', flags: [] },
  // The CLI's data-only dump includes Auth/Storage rows, but not migration history.
  { name: 'data.sql', flags: ['--data-only', '--use-copy'] },
  { name: 'history-schema.sql', flags: ['--schema', 'supabase_migrations'] },
  { name: 'history-data.sql', flags: ['--data-only', '--use-copy', '--schema', 'supabase_migrations'] },
  // Reference copy: includes platform objects; do NOT blindly restore over managed schemas.
  { name: 'auth-storage-schema.sql', flags: ['--schema', 'auth,storage'] },
]

export function parseArguments(args) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') return { help: true }
    const key = { '--output-dir': 'outputDirectory' }[args[i]]
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Unknown or missing argument. Use --help.')
    }
    options[key] = args[++i]
  }
  return options
}

// Do not forward CLI diagnostics: they can contain connection URLs or credentials.
export function runCommand(command, args, { cwd, stage }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-65_536) })
    child.stderr.resume()
    let interrupted = false
    const interrupt = () => {
      interrupted = true
      child.kill('SIGTERM')
    }
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', interrupt)
    const detach = () => {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', interrupt)
    }
    child.once('error', () => {
      detach()
      reject(new Error(`${stage} could not start. Check the required tools and configuration.`))
    })
    child.once('close', (code) => {
      detach()
      if (code === 0 && !interrupted) resolve(output.trim())
      else reject(new Error(`${stage} failed (exit ${code ?? 'interrupted'}). CLI diagnostics were withheld to protect credentials.`))
    })
  })
}

export async function secureDirectory(directory, run, platform, cwd) {
  if (platform !== 'win32') {
    await chmod(directory, 0o700)
    return
  }
  const identity = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { cwd, stage: 'Windows identity lookup' })
  const sid = identity.match(/S-1-5-(?:\d+-)*\d+/)?.[0]
  if (!sid) throw new Error('Cannot determine the Windows account SID; no database export was started.')
  await run('icacls.exe', [
    directory, '/inheritance:r', '/grant:r',
    `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F',
  ], { cwd, stage: 'Private backup-folder permissions' })
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function resolveCli(repoDirectory) {
  try {
    const require = createRequire(path.join(repoDirectory, 'package.json'))
    const packageFile = require.resolve('supabase/package.json')
    const metadata = require(packageFile)
    return path.resolve(path.dirname(packageFile), metadata.bin.supabase)
  } catch {
    throw new Error('The installed Supabase CLI was not found. Run npm ci, then configure supabase login/link.')
  }
}

async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * @param {{outputDirectory?: string, repoDirectory?: string}} options
 * @param {object} dependencies Test-only substitutes; the command-line interface exposes none.
 */
export async function createBackup(options = {}, dependencies = {}) {
  const run = dependencies.run ?? runCommand
  const platform = dependencies.platform ?? process.platform
  const now = dependencies.now ?? (() => new Date())
  const repoDirectory = await realpath(options.repoDirectory ?? REPO_DIRECTORY)
  const requestedOutput = options.outputDirectory ?? DEFAULT_OUTPUT_DIRECTORY
  if (!path.isAbsolute(requestedOutput)) throw new Error('The backup output directory must be an absolute path.')
  const outputDirectory = path.resolve(requestedOutput)
  if (isInside(repoDirectory, outputDirectory)) throw new Error('Backups must be stored outside the repository.')

  // Deliberately fixed: never follow a changed link, .env database URL or local stack.
  const projectRef = LIVE_PROJECT_REF

  const cliPath = dependencies.cliPath ?? resolveCli(repoDirectory)
  const cliVersion = await run(process.execPath, [cliPath, '--version'], { cwd: repoDirectory, stage: 'Supabase CLI version check' })
  if (!/^\d+\.\d+\.\d+/.test(cliVersion)) throw new Error('Cannot determine the installed Supabase CLI version.')
  await run('docker', ['info', '--format', '{{.ServerVersion}}'], { cwd: repoDirectory, stage: 'Docker Desktop availability check' })

  await mkdir(outputDirectory, { recursive: true })
  const canonicalOutput = await realpath(outputDirectory)
  if (isInside(repoDirectory, canonicalOutput)) throw new Error('The output directory resolves inside the repository.')
  const startedAt = now().toISOString()
  const name = `${projectRef}-${startedAt.replace(/[:.]/g, '-')}-${randomUUID()}`
  const finalDirectory = path.join(canonicalOutput, name)
  const partialDirectory = `${finalDirectory}.partial`
  await mkdir(partialDirectory, { mode: 0o700 })
  let stage = 'securing the backup folder'
  try {
    await secureDirectory(partialDirectory, run, platform, repoDirectory)
    const files = []
    for (const item of EXPORTS) {
      stage = `exporting ${item.name}`
      const file = path.join(partialDirectory, item.name)
      await run(process.execPath, [
        cliPath, 'db', 'dump', '--project-ref', projectRef, '--file', file, ...item.flags,
      ], { cwd: repoDirectory, stage })
      const info = await lstat(file)
      if (!info.isFile() || info.size === 0) throw new Error('Missing or empty export.')
      if (platform !== 'win32') await chmod(file, 0o600)
      files.push({ name: item.name, bytes: info.size, sha256: await hashFile(file) })
    }
    stage = 'writing the backup manifest'
    const manifest = {
      format: 'supabase-logical-backup-v1', state: 'export-complete', source: 'live-supabase', projectRef,
      cliVersion: cliVersion.split(/\r?\n/)[0], startedAt, completedAt: now().toISOString(),
      files, restoreVerified: false,
      notes: [
        'Separate dumps do not share a snapshot. Do not run schema changes during this export.',
        'data.sql includes Auth/Storage database rows, not Storage object files.',
        'auth-storage-schema.sql is a reference copy; review platform objects before restoring.',
        'Platform settings, API/JWT secrets, Vault secrets, Edge Functions and custom-role passwords are not backed up.',
        'Treat every file as sensitive. Do not commit it. Validate restoration on a disposable compatible Supabase instance.',
      ],
    }
    await writeFile(path.join(partialDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    stage = 'publishing the completed backup folder'
    // Both paths are generated siblings under the resolved, explicit output root.
    await rename(partialDirectory, finalDirectory)
    return { directory: finalDirectory, manifest }
  } catch {
    throw new Error(`Backup failed while ${stage}. Incomplete files remain in ${partialDirectory}; do not use them as a completed backup.`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) {
      console.log('Usage: node scripts/backup-supabase.mjs [--output-dir ABSOLUTE_PATH]')
      console.log(`Live Supabase project: ${LIVE_PROJECT_REF}. Default output: ${DEFAULT_OUTPUT_DIRECTORY}.`)
      console.log('Requires Docker Desktop for the export utility and configured Supabase CLI access; no local/native database is used.')
    } else {
      const result = await createBackup(options)
      console.log(`Backup export complete: ${result.directory}`)
      console.log('Checksums are in manifest.json. Restoration has not been verified; protect these sensitive files.')
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Backup failed.')
    process.exitCode = 1
  }
}
