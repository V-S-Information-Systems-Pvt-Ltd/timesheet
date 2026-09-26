import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createBackup, DEFAULT_OUTPUT_DIRECTORY, LIVE_PROJECT_REF, parseArguments, runCommand, secureDirectory,
} from '../scripts/backup-supabase.mjs'

const PROJECT = 'bcsdqkjzobllocejfcdz'
let temporary: string
let repository: string
let output: string

beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'vsis-backup-test-'))
  repository = path.join(temporary, 'repository')
  output = path.join(temporary, 'private backups')
  await mkdir(path.join(repository, 'supabase', '.temp'), { recursive: true })
  await writeFile(path.join(repository, 'supabase', '.temp', 'project-ref'), `${PROJECT}\n`)
})

afterEach(async () => {
  // Only the exact test-owned temporary directory is removed.
  await rm(temporary, { recursive: true, force: true })
})

function fakeRunner(failFile?: string, emptyFile?: string) {
  return vi.fn(async (_command: string, args: string[], _context: { cwd: string; stage: string }): Promise<string> => {
    if (args.includes('--version')) return '2.117.0'
    if (args.includes('info')) return '28.0.0'
    const index = args.indexOf('--file')
    if (index >= 0) {
      const file = args[index + 1]
      if (path.basename(file) === failFile) throw new Error('postgresql://secret-user:secret-password@host/database')
      await writeFile(file, path.basename(file) === emptyFile ? '' : `-- synthetic export: ${path.basename(file)}\n`)
    }
    return ''
  })
}

function dependencies(run = fakeRunner()) {
  return { run, platform: 'linux', cliPath: '/test-only/supabase.js', now: () => new Date('2026-09-26T05:00:00.000Z') }
}

describe('Supabase logical backup script', () => {
  it('defaults to the requested destination and parses only supported arguments', () => {
    expect(DEFAULT_OUTPUT_DIRECTORY).toBe('C:\\dev\\db-backup')
    expect(parseArguments([])).toEqual({})
    expect(LIVE_PROJECT_REF).toBe(PROJECT)
    expect(parseArguments(['--output-dir', output])).toEqual({ outputDirectory: output })
    expect(parseArguments(['--help'])).toEqual({ help: true })
    expect(() => parseArguments(['--output-dir'])).toThrow('Unknown or missing argument')
    expect(() => parseArguments(['--db-url', 'postgresql://secret'])).toThrow('Unknown or missing argument')
    expect(() => parseArguments(['--project-ref', 'other-project'])).toThrow('Unknown or missing argument')
  })

  it('pins the live project, exports six files, verifies hashes, and publishes once', async () => {
    const run = fakeRunner()
    const result = await createBackup({ outputDirectory: output, repoDirectory: repository }, dependencies(run))
    expect(path.dirname(result.directory)).toBe(await realpath(output))
    expect(result.directory).not.toMatch(/\.partial$/)
    expect(await readdir(output)).toHaveLength(1)
    expect(result.manifest.projectRef).toBe(PROJECT)
    expect(result.manifest.source).toBe('live-supabase')
    expect(result.manifest.restoreVerified).toBe(false)
    const manifest = JSON.parse(await readFile(path.join(result.directory, 'manifest.json'), 'utf8'))
    expect(manifest.state).toBe('export-complete')
    expect(manifest.files).toHaveLength(6)
    for (const entry of manifest.files) {
      const contents = await readFile(path.join(result.directory, entry.name))
      expect(entry.bytes).toBe(contents.length)
      expect(entry.sha256).toBe(createHash('sha256').update(contents).digest('hex'))
    }
    const dumps = run.mock.calls.filter((call) => call[1].includes('--file'))
    expect(dumps).toHaveLength(6)
    for (const [, args] of dumps) {
      expect(args).toContain('dump')
      expect(args[args.indexOf('--project-ref') + 1]).toBe(PROJECT)
      expect(args).not.toContain('--db-url')
      expect(args).not.toContain('--local')
      expect(args).not.toContain('--linked')
      expect(args).not.toContain('push')
      expect(args).not.toContain('--dry-run')
    }
    expect(dumps.filter((call) => call[1].includes('supabase_migrations'))).toHaveLength(2)
    expect(dumps.some((call) => call[1].includes('auth,storage'))).toBe(true)
    expect(dumps.find((call) => call[1].includes('--data-only') && !call[1].includes('--schema'))?.[1]).toContain('--use-copy')
    if (process.platform !== 'win32') expect((await lstat(result.directory)).mode & 0o777).toBe(0o700)
  })

  it('never overwrites an earlier backup, even with identical timestamps', async () => {
    const options = { outputDirectory: output, repoDirectory: repository }
    const first = await createBackup(options, dependencies())
    const second = await createBackup(options, dependencies())
    expect(first.directory).not.toBe(second.directory)
    expect(await readdir(output)).toHaveLength(2)
  })

  it('does not publish partial exports or expose the failing CLI diagnostics', async () => {
    const run = fakeRunner('data.sql')
    const operation = createBackup({ outputDirectory: output, repoDirectory: repository }, dependencies(run))
    await expect(operation).rejects.toThrow('Backup failed while exporting data.sql')
    await expect(operation).rejects.not.toThrow('secret-password')
    const folders = await readdir(output)
    expect(folders).toHaveLength(1)
    expect(folders[0]).toMatch(/\.partial$/)
    expect(await readdir(path.join(output, folders[0]))).not.toContain('manifest.json')
    expect(run.mock.calls.filter((call) => call[1].includes('--file'))).toHaveLength(3)
  })

  it('rejects an empty export even if the command exits successfully', async () => {
    await expect(createBackup({ outputDirectory: output, repoDirectory: repository }, dependencies(fakeRunner(undefined, 'schema.sql'))))
      .rejects.toThrow('Backup failed while exporting schema.sql')
    const folders = await readdir(output)
    expect(folders[0]).toMatch(/\.partial$/)
  })

  it('fails preflight without making backup folders when Docker is unavailable', async () => {
    const run = fakeRunner()
    run.mockImplementationOnce(async () => '2.117.0')
    run.mockImplementationOnce(async () => { throw new Error('Docker Desktop is stopped') })
    await expect(createBackup({ outputDirectory: output, repoDirectory: repository }, dependencies(run))).rejects.toThrow('Docker Desktop is stopped')
    expect(await readdir(temporary)).toEqual(['repository'])
    expect(run.mock.calls.some((call) => call[1].includes('--file'))).toBe(false)
  })

  it('never follows a local/other project link or falls back to an environment URL', async () => {
    const run = fakeRunner()
    await writeFile(path.join(repository, 'supabase', '.temp', 'project-ref'), 'local-project\n')
    await createBackup({ outputDirectory: output, repoDirectory: repository }, dependencies(run))
    await rm(path.join(repository, 'supabase', '.temp', 'project-ref'))
    await createBackup({ outputDirectory: output, repoDirectory: repository }, dependencies(run))
    for (const [, args] of run.mock.calls.filter((call) => call[1].includes('--file'))) {
      expect(args[args.indexOf('--project-ref') + 1]).toBe(PROJECT)
      expect(args).not.toContain('--db-url')
      expect(args).not.toContain('--local')
    }
  })

  it('rejects both direct and symlink-resolved output paths inside the repository', async () => {
    await expect(createBackup({ outputDirectory: path.join(repository, 'backups'), repoDirectory: repository }, dependencies()))
      .rejects.toThrow('outside the repository')
    const link = path.join(temporary, 'outside-link')
    await symlink(repository, link, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(createBackup({ outputDirectory: link, repoDirectory: repository }, dependencies())).rejects.toThrow('resolves inside')
    expect(await readdir(repository)).toEqual(['supabase'])
  })

  it('restricts Windows ACLs using explicit account/System/Admin SIDs', async () => {
    const run = vi.fn(async (_command: string, _args: string[], _context: object) => '"account","S-1-5-21-1-2-3-1001"')
    await secureDirectory(output, run, 'win32', repository)
    expect(run.mock.calls[1][0]).toBe('icacls.exe')
    expect(run.mock.calls[1][1]).toEqual([
      output, '/inheritance:r', '/grant:r', '*S-1-5-21-1-2-3-1001:(OI)(CI)F',
      '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F',
    ])
  })

  it('fails closed when private Windows ACLs cannot be established', async () => {
    const run = fakeRunner()
    run.mockImplementation(async (_command, args) => {
      if (args.includes('--version')) return '2.117.0'
      if (args.includes('info')) return '28.0.0'
      if (args.includes('/user')) return '"account","S-1-5-21-1-2-3-1001"'
      throw new Error('permission failure')
    })
    await expect(createBackup({ outputDirectory: output, repoDirectory: repository }, { ...dependencies(run), platform: 'win32' }))
      .rejects.toThrow('securing the backup folder')
    expect(run.mock.calls.some((call) => call[1].includes('--file'))).toBe(false)
  })

  it('withholds subprocess diagnostics containing credentials', async () => {
    const command = runCommand(process.execPath, ['-e', "console.error('synthetic-private-diagnostic'); process.exit(7)"], { cwd: repository, stage: 'Test command' })
    await expect(command).rejects.toThrow('exit 7')
    await expect(command).rejects.not.toThrow('synthetic-private-diagnostic')
  })
})
