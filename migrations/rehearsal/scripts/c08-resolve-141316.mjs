// Offline-only approved C08 resolution. No database clients or apply command.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runCli } from '../../tool/src/cli.ts'
import { canonicalStringify, canonicalizeTimestampText, sha256Hex, ENTITY_ORDER } from '../../tool/src/format.ts'
import { verifyResolvedPlan } from '../../tool/src/resolutions.ts'
import { validateBundleDirectory } from '../../tool/src/validation.ts'

const root = process.cwd()
const artifacts = 'C:\\Users\\kasku\\AppData\\Local\\Temp\\vsis-migration-resume-20261004-141316'
const oldArtifacts = 'C:\\Users\\kasku\\AppData\\Local\\Temp\\vsis-migration-dryrun-20261004-105004'
const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
const equal = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const assert = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }) }
const writeNew = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' })
const report = { status: 'resolving-only', startedAt: new Date().toISOString(), applyRan: false, databaseOperations: false, artifacts }
function acl() {
  const script = `$ErrorActionPreference='Stop'; $taskRoot='${artifacts}'; $taskSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $taskAllowed=@($taskSid,'S-1-5-18','S-1-5-32-544'); if(-not (Get-Acl -LiteralPath $taskRoot).AreAccessRulesProtected){throw 'Root inheritance enabled'}; $taskItems=@(Get-Item -LiteralPath $taskRoot)+@(Get-ChildItem -LiteralPath $taskRoot -Recurse -Force); foreach($taskItem in $taskItems){if($taskItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint){throw 'Reparse point refused'}; $taskRules=(Get-Acl -LiteralPath $taskItem.FullName).GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]); foreach($taskRule in $taskRules){if($taskRule.AccessControlType -eq 'Allow' -and $taskRule.IdentityReference.Value -notin $taskAllowed){throw 'Unexpected ACL principal'}}; if(@($taskRules | Where-Object {$_.AccessControlType -eq 'Allow'}).Count -ne 3){throw 'Expected three principals'}}; @{rootInheritanceDisabled=$true;allowedPrincipals='current operator, SYSTEM, Administrators';filesChecked=@($taskItems | Where-Object {-not $_.PSIsContainer}).Count}|ConvertTo-Json -Compress`
  const result = spawnSync('C:\\Users\\kasku\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\powershell\\pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true })
  assert(result.status === 0, 'E_ACL_VERIFY')
  return JSON.parse(result.stdout.trim())
}
try {
  report.aclBefore = acl()
  const approval = readJson(join(root, 'migrations/rehearsal/local/c08-root-review.json'))
  const phase1 = readJson(join(artifacts, 'phase1-safe-summary.json'))
  const planPath = join(artifacts, 'rehearsal-preview.json')
  const plan = readJson(planPath)
  const old = readJson(join(oldArtifacts, 'rehearsal-resolved-closure.json'))
  const choices = readJson(join(artifacts, 'prior-decisions-protected-copy.json'))
  assert(approval.planDigest === '1c3f17257f818b6271b9fdfb200c61bd5afb4e2645dd005d2e9e492cfb7f5aa5' && plan.planDigest === approval.planDigest, 'E_APPROVED_PLAN')
  assert(phase1.status === 'preview-ready-awaiting-root-review' && !phase1.parity.requiresChangedConflictReview, 'E_PHASE1_PARITY')
  assert(plan.target.provider === 'native' && plan.target.namespace === approval.targetNamespace && plan.target.runtimeFingerprint === approval.targetRuntimeFingerprint && plan.target.applicationVersion === '1.1.6', 'E_TARGET_BINDING')
  assert(plan.sourceInstance.provider === 'supabase' && plan.sourceInstance.applicationVersion === '1.0.3', 'E_SOURCE_BINDING')
  assert(equal(plan.unresolved, old.plan.unresolved) && equal(plan.entries, old.plan.entries), 'E_CONFLICT_PARITY')
  assert(equal(plan.snapshot, old.plan.snapshot), 'E_BOUND_SNAPSHOT_PARITY')
  assert(equal(choices, old.decisions), 'E_APPROVED_CHOICE_PARITY')
  const validation = await validateBundleDirectory(join(artifacts, 'source-bundle'))
  assert(validation.ok && validation.bundleDigest === plan.bundleDigest && validation.manifest.tool.applicationVersion === validation.manifest.source.applicationVersion && validation.manifest.source.applicationVersion === '1.0.3', 'E_FRESH_BUNDLE')
  const oldManifest = readJson(join(oldArtifacts, 'source-bundle/manifest.json'))
  assert(validation.manifest.entities.every(entity => entity.sha256 === oldManifest.entities.find(previous => previous.entity === entity.entity)?.sha256), 'E_CANONICAL_SOURCE_PARITY')
  report.rootReview = { startedAt: phase1.rootReviewStartedAt, approvedAt: approval.reviewedAt, seconds: (Date.parse(approval.reviewedAt) - Date.parse(phase1.rootReviewStartedAt)) / 1000 }
  report.normalSequenceStartedAt = phase1.normalSequenceStartedAt
  const decisions = { ...choices, planDigest: plan.planDigest, operator: { ...choices.operator, at: canonicalizeTimestampText(new Date().toISOString()) } }
  const decisionsPath = join(artifacts, 'rehearsal-decisions-approved.json')
  const resolvedPath = join(artifacts, 'rehearsal-resolved.json')
  assert(!existsSync(decisionsPath) && !existsSync(resolvedPath), 'E_OUTPUT_ALREADY_EXISTS')
  writeNew(decisionsPath, decisions)
  const output = []; const errors = []
  report.resolveStartedAt = new Date().toISOString()
  const code = await runCli(['resolve', '--plan', planPath, '--decisions', decisionsPath, '--out', resolvedPath, '--json'], { env: {}, cwd: join(root, 'migrations/tool'), runRoot: join(artifacts, 'journals-resolution'), out: line => output.push(line), err: line => errors.push(line) })
  report.resolveEndedAt = new Date().toISOString()
  report.resolveSeconds = (Date.parse(report.resolveEndedAt) - Date.parse(report.resolveStartedAt)) / 1000
  writeNew(join(artifacts, 'resolution-private-cli.json'), { code, output, errors })
  assert(code === 0, `E_RESOLVE_${code}`)
  const resolved = readJson(resolvedPath)
  const issues = verifyResolvedPlan(resolved)
  assert(issues.length === 0, 'E_RESOLVED_VERIFICATION')
  assert(resolved.expectedResultDigest === approval.expectedResultDigest && resolved.expectedResultDigest === 'aff9274b4abc44921625980451c54fc66a6da3bbfdf27d1f6661521fdea8344e', 'E_EXPECTED_RESULT_PARITY')
  assert(equal(resolved.idMap, old.idMap) && equal(resolved.expectedResult, old.expectedResult) && equal(resolved.perEntityDigest, old.perEntityDigest), 'E_RESOLVED_ROW_MAPPING_PARITY')
  assert(equal(resolved.decisions.decisions, old.decisions.decisions) && equal(resolved.decisions.security, old.decisions.security) && equal(resolved.decisions.settings, old.decisions.settings), 'E_RESOLVED_SECURITY_SETTINGS_PARITY')
  report.status = 'resolved-verified-awaiting-root-pin'
  report.runId = phase1.runId
  report.planDigest = resolved.plan.planDigest
  report.resolutionDigest = resolved.resolutionDigest
  report.expectedResultDigest = resolved.expectedResultDigest
  report.verifyResolvedPlanIssueCount = issues.length
  report.idMapUnchanged = true; report.expectedRowsUnchanged = true; report.securitySettingsSemanticsUnchanged = true
  report.approvedMappingCount = decisions.decisions.length
  report.securityChoiceCount = decisions.security.length; report.settingsChoiceCount = Object.keys(decisions.settings).length
  report.targetBinding = { database: phase1.database, provider: resolved.plan.target.provider, namespace: resolved.plan.target.namespace, runtimeFingerprint: resolved.plan.target.runtimeFingerprint, schemaFingerprint: resolved.plan.target.schemaFingerprint, applicationVersion: resolved.plan.target.applicationVersion }
  report.index0038Phase1Proof = phase1.index0038
  report.expectedCounts = Object.fromEntries(ENTITY_ORDER.map(entity => [entity, resolved.expectedResult[entity].length]))
  report.artifactDigests = { previewFile: sha256Hex(readFileSync(planPath)), resolvedFile: sha256Hex(readFileSync(resolvedPath)), approvedDecisionsFile: sha256Hex(readFileSync(decisionsPath)) }
  report.paths = { resolved: resolvedPath, decisions: decisionsPath }
  report.completedAt = new Date().toISOString()
  report.normalElapsedSeconds = (Date.now() - Date.parse(phase1.normalSequenceStartedAt)) / 1000
  report.aclAfter = acl()
  writeNew(join(artifacts, 'resolution-safe-summary.json'), report)
  writeNew(join(root, 'migrations/rehearsal/local/c08-resolve-progress.json'), report)
  console.log(JSON.stringify(report))
} catch (error) {
  report.status = 'stopped-on-error'; report.errorCode = String(error.code ?? 'E_RESOLUTION_FAILURE')
  try { writeNew(join(artifacts, 'resolution-failure-safe-summary.json'), report) } catch {}
  console.log(JSON.stringify(report)); process.exitCode = 1
}
