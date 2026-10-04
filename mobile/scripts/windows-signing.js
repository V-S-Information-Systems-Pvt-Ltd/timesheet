const { spawnSync } = require('child_process');
const path = require('path');

// Static code; all operator input is supplied through the child environment.
const inspectCertificate = `
$ErrorActionPreference = 'Stop'
$stage = 'INITIALIZATION_FAILED'
try {
  $null = Get-Command Get-PfxData -ErrorAction Stop
  $pfxPassword = ConvertTo-SecureString $env:VSIS_SIGNING_PASSWORD -AsPlainText -Force
  $stage = 'PFX_READ_FAILED'
  $pfx = Get-PfxData -FilePath $env:VSIS_SIGNING_PFX_PATH -Password $pfxPassword
  $stage = 'MANIFEST_READ_FAILED'
  [xml]$manifest = Get-Content -LiteralPath $env:VSIS_SIGNING_MANIFEST_PATH -Raw
  $publisher = [string]$manifest.Package.Identity.Publisher
  if ([string]::IsNullOrWhiteSpace($publisher)) { throw 'Missing publisher' }
  $stage = 'CERTIFICATE_FILTER_FAILED'
  $certificates = @($pfx.EndEntityCertificates)
  $publisherMatches = @($certificates | Where-Object { $_.Subject -ceq $publisher })
  $leafMatches = @($publisherMatches | Where-Object {
    $constraints = $_.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' }
    -not $constraints.CertificateAuthority
  })
  $usageMatches = @($leafMatches | Where-Object {
    $eku = $_.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' }
    @($eku.EnhancedKeyUsages | Where-Object { $_.Value -eq '1.3.6.1.5.5.7.3.3' }).Count -gt 0
  })
  $matches = @($usageMatches | Where-Object {
    -not $env:VSIS_SIGNING_THUMBPRINT -or $_.Thumbprint -eq $env:VSIS_SIGNING_THUMBPRINT
  })
  if ($matches.Count -ne 1) {
    $code = if ($matches.Count -gt 1) { 'AMBIGUOUS_SIGNER' }
      elseif ($certificates.Count -eq 0) { 'NO_END_ENTITY_CERTIFICATE' }
      elseif ($publisherMatches.Count -eq 0) { 'PUBLISHER_MISMATCH' }
      elseif ($leafMatches.Count -eq 0) { 'CA_CERTIFICATE_ONLY' }
      elseif ($usageMatches.Count -eq 0) { 'CODE_SIGNING_USAGE_MISSING' }
      else { 'THUMBPRINT_MISMATCH' }
    $diagnostic = @{ code = $code; certificates = $certificates.Count;
      publisherMatches = $publisherMatches.Count; leafMatches = $leafMatches.Count;
      usageMatches = $usageMatches.Count; matches = $matches.Count }
    [Console]::Error.WriteLine(($diagnostic | ConvertTo-Json -Compress))
    exit 1
  }
  [Console]::Out.WriteLine($matches[0].Thumbprint)
} catch {
  [Console]::Error.WriteLine((@{ code = $stage } | ConvertTo-Json -Compress))
  exit 1
}
`;

function resolveSigningThumbprint({ pfxPath, password, manifestPath, thumbprint = '', env = process.env, run = spawnSync }) {
  const requested = thumbprint.replace(/\s/g, '').toUpperCase();
  if (requested && !/^[0-9A-F]{40}$/.test(requested)) {
    throw new Error('WINDOWS_CERT_THUMBPRINT must be a 40-character hexadecimal certificate thumbprint.');
  }
  const powershell = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // Windows PowerShell cannot load modules inherited from a PowerShell 7 host.
  const modulePath = [path.join(path.dirname(powershell), 'Modules'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'WindowsPowerShell', 'Modules')].join(';');
  let result;
  try {
    result = run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', inspectCertificate], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      env: { ...env, PSModulePath: modulePath, VSIS_SIGNING_PFX_PATH: pfxPath, VSIS_SIGNING_PASSWORD: password,
        VSIS_SIGNING_MANIFEST_PATH: manifestPath, VSIS_SIGNING_THUMBPRINT: requested },
    });
  } catch {
    throw new Error('Cannot start signing certificate inspection. Check the Windows PowerShell installation and signing configuration.');
  }
  const selected = (result.stdout || '').trim().toUpperCase();
  if (result.error || result.status !== 0 || !/^[0-9A-F]{40}$/.test(selected) || (requested && selected !== requested)) {
    // Never forward raw process diagnostics: PFX passwords must not reach logs.
    const messages = {
      INITIALIZATION_FAILED: 'Windows PowerShell could not load the built-in PKI commands.',
      PFX_READ_FAILED: 'The PFX could not be opened or decrypted. Check WINDOWS_CERT_PATH, the PFX password, file permissions and PFX format.',
      MANIFEST_READ_FAILED: 'The package manifest could not be read or has no Publisher.',
      CERTIFICATE_FILTER_FAILED: 'The PFX certificate metadata could not be checked.',
      NO_END_ENTITY_CERTIFICATE: 'The PFX contains no end-entity app certificate. Export the app certificate with its private key, rather than the CA backup.',
      PUBLISHER_MISMATCH: 'No app certificate Subject matches the package manifest Publisher.',
      CA_CERTIFICATE_ONLY: 'Only CA certificates match the package Publisher. Use the app Code Signing certificate.',
      CODE_SIGNING_USAGE_MISSING: 'The matching app certificate has no explicit Code Signing EKU (1.3.6.1.5.5.7.3.3).',
      THUMBPRINT_MISMATCH: 'WINDOWS_CERT_THUMBPRINT does not match an eligible app certificate in this PFX. Clear the stale setting or use the correct app thumbprint.',
      AMBIGUOUS_SIGNER: 'Multiple eligible app certificates match. Set WINDOWS_CERT_THUMBPRINT to the intended app certificate.',
    };
    let diagnostic;
    try { diagnostic = JSON.parse(result.stderr || ''); } catch { /* Untrusted process output is discarded. */ }
    if (diagnostic && Object.hasOwn(messages, diagnostic.code)) {
      const keys = ['certificates', 'publisherMatches', 'leafMatches', 'usageMatches', 'matches'];
      const counts = keys.filter(key => Number.isSafeInteger(diagnostic[key]) && diagnostic[key] >= 0)
        .map(key => `${key}=${diagnostic[key]}`).join(', ');
      throw new Error(`Signing certificate selection failed [${diagnostic.code}]: ${messages[diagnostic.code]}${counts ? ` (${counts})` : ''}`);
    }
    if (result.error && result.error.code === 'ETIMEDOUT') {
      throw new Error('Signing certificate selection failed: Windows PowerShell inspection timed out after 30 seconds.');
    }
    throw new Error('Signing certificate selection failed. Check the PFX password and a non-CA Code Signing certificate matching the manifest Publisher; use WINDOWS_CERT_THUMBPRINT if multiple leaves match.');
  }
  return selected;
}

module.exports = { resolveSigningThumbprint };
