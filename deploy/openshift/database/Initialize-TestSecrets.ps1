[CmdletBinding()]
param(
  [string]$Oc = 'oc',
  [string]$Namespace = 'timesheet-test',
  [string]$ExpectedServer = 'https://api.crc.testing:6443',
  [string]$AdminEmail = 'admin@timesheet.test'
)
$ErrorActionPreference = 'Stop'
$server = & $Oc whoami --show-server
if ($LASTEXITCODE -ne 0 -or $server.TrimEnd('/') -ne $ExpectedServer.TrimEnd('/')) {
  throw 'Active OpenShift context does not match the expected test cluster.'
}
function Read-Secret([string]$Name) {
  $result = & $Oc get secret $Name -n $Namespace --ignore-not-found -o json
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect secret $Name" }
  if ($result) { return ($result | ConvertFrom-Json) }
  return $null
}
function New-RandomValue {
  return [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
}
function Create-Secret([string]$Name, [hashtable]$Values) {
  $object = @{ apiVersion='v1'; kind='Secret'; metadata=@{name=$Name; namespace=$Namespace}; type='Opaque'; stringData=$Values }
  $object | ConvertTo-Json -Depth 8 -Compress | & $Oc create -f - -o name
  if ($LASTEXITCODE -ne 0) { throw "Could not create secret $Name" }
}
$db = Read-Secret 'vsis-timesheet-db'
if (-not $db) {
  $volume = & $Oc get pvc timesheet-postgres-data -n $Namespace --ignore-not-found -o name
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect database volume.' }
  if ($volume) { throw 'Database PVC exists without its secret. Recover the original credentials before proceeding.' }
  Create-Secret 'vsis-timesheet-db' @{
    POSTGRESQL_USER='vsis'; POSTGRESQL_DATABASE='vsis'; POSTGRESQL_PASSWORD=(New-RandomValue)
  }
  $db = Read-Secret 'vsis-timesheet-db'
}
if (-not (Read-Secret 'vsis-timesheet-secret')) {
  $password = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($db.data.POSTGRESQL_PASSWORD))
  Create-Secret 'vsis-timesheet-secret' @{
    DATABASE_URL="postgresql://vsis:$password@postgresql:5432/vsis"
    AUTH_SECRET=(New-RandomValue)
    MOBILE_AUTH_SECRET=(New-RandomValue)
    RATE_LIMIT_SUBJECT_SECRET=(New-RandomValue)
    CRON_SECRET=(New-RandomValue)
  }
}
if (-not (Read-Secret 'vsis-timesheet-bootstrap')) {
  Create-Secret 'vsis-timesheet-bootstrap' @{
    ADMIN_EMAIL=$AdminEmail; ADMIN_PASSWORD=('Ts1!' + (New-RandomValue))
  }
}
Write-Output 'Test secrets are available. Existing secrets were retained; no credential values were printed.'
