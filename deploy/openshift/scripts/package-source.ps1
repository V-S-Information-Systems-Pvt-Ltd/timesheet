[CmdletBinding()]
param(
  [Parameter()]
  [string]$OutputDirectory,
  [ValidateSet('native', 'supabase')]
  [string]$Backend = 'native'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$allowedRootFiles = @(
  'instrumentation.ts',
  'next.config.ts',
  'package-lock.json',
  'package.json',
  'postcss.config.mjs',
  'tsconfig.json'
)
$allowedSourceRoots = @('app/', 'db/', 'lib/', 'packages/', 'public/')
$allowedExtraFiles = @(
  'scripts/copy-standalone-assets.mjs',
  'scripts/verify-supabase-auth-config.mjs',
  'migrations/tool/package.json'
)
$excludedPathPattern = '(?i)(^|/)(tests?|__tests__|fixtures|coverage|\.git|\.ua|\.next|node_modules)(/|$)|(^|/)\.env[^/]*($|/)|(^|/)(\.npmrc|\.netrc|\.git-credentials|credentials\.(json|ya?ml|toml|ini|txt)|secrets\.(json|ya?ml|toml|ini))($|/)|\.(pem|key|p12|pfx)$|\.(test|spec)\.[^/]+$'

if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("vsis-openshift-context-" + [guid]::NewGuid().ToString('N'))
}
$contextPath = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $contextPath) {
  if ((Get-ChildItem -LiteralPath $contextPath -Force | Measure-Object).Count -gt 0) {
    throw "Output directory must be empty: $contextPath"
  }
} else {
  New-Item -ItemType Directory -Path $contextPath | Out-Null
}

$paths = @(& git -C $repoRoot ls-files --cached --others --exclude-standard)
if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed; no build context was prepared.' }
$copied = 0
$totalBytes = [int64]0

foreach ($entry in $paths) {
  $relative = ([string]$entry).Replace('\', '/')
  if (-not $relative -or $relative -match $excludedPathPattern) { continue }

  $isAllowed = $allowedRootFiles -contains $relative -or $allowedExtraFiles -contains $relative
  if (-not $isAllowed) {
    foreach ($sourceRoot in $allowedSourceRoots) {
      if ($relative.StartsWith($sourceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $isAllowed = $true
        break
      }
    }
  }
  if (-not $isAllowed) { continue }

  $sourcePath = Join-Path $repoRoot ($relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
  $destinationPath = Join-Path $contextPath ($relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
  $destinationParent = Split-Path -Parent $destinationPath
  New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
  $copied++
  $totalBytes += (Get-Item -LiteralPath $destinationPath).Length
}

$requiredFiles = @(
  'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json',
  'postcss.config.mjs', 'scripts/copy-standalone-assets.mjs',
  'scripts/verify-supabase-auth-config.mjs',
  'packages/core/package.json', 'packages/contracts/package.json',
  'packages/client/package.json', 'migrations/tool/package.json',
  'db/seed.mjs', 'db/migrate-runner.mjs'
)
$missing = @($requiredFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $contextPath $_) -PathType Leaf) })
if ($missing.Count -gt 0) { throw "Build context is incomplete: $($missing -join ', ')" }

$unsafeFiles = @(Get-ChildItem -LiteralPath $contextPath -Force -Recurse -File | Where-Object {
  $_.Name -match '(?i)^\.env|^\.npmrc$|^\.netrc$|^\.git-credentials$|^credentials\.(json|ya?ml|toml|ini|txt)$|^secrets\.(json|ya?ml|toml|ini)$|\.(pem|key|p12|pfx)$'
})
if ($unsafeFiles.Count -gt 0) { throw "Sensitive-looking files entered the context: $($unsafeFiles.Name -join ', ')" }

$dockerfileName = if ($Backend -eq 'supabase') { 'Dockerfile.supabase' } else { 'Dockerfile' }
$dockerfile = Join-Path $PSScriptRoot ('..\' + $dockerfileName)
Copy-Item -LiteralPath (Resolve-Path $dockerfile).Path -Destination (Join-Path $contextPath 'Dockerfile')
$totalBytes += (Get-Item -LiteralPath (Join-Path $contextPath 'Dockerfile')).Length
$copied++

[pscustomobject]@{
  ContextDirectory = $contextPath
  FileCount = $copied
  SizeMiB = [math]::Round($totalBytes / 1MB, 2)
  SecretFilenameScan = 'passed'
  Backend = $Backend
} | ConvertTo-Json -Compress
