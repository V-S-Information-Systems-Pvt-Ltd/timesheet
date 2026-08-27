const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function findMSBuild() {
  // 1. Try finding msbuild directly from PATH
  try {
    const which = process.platform === 'win32' ? 'where msbuild' : 'which msbuild';
    const out = execSync(which, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    if (out) {
      const first = out.split(/\r?\n/)[0].trim();
      if (fs.existsSync(first)) return first;
    }
  } catch {}

  // 2. Try vswhere
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vswhere = path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (fs.existsSync(vswhere)) {
    try {
      const out = execSync(`"${vswhere}" -latest -requires Microsoft.Component.MSBuild -find MSBuild\\**\\Bin\\MSBuild.exe`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (out) {
        const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length > 0 && fs.existsSync(lines[0])) {
          return lines[0];
        }
      }
    } catch {}
  }

  // 3. Known Visual Studio / Build Tools install paths
  const candidates = [
    'C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\MSBuild\\Current\\Bin\\MSBuild.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  throw new Error('MSBuild.exe could not be found. Please ensure Visual Studio or Build Tools is installed.');
}

function ensureCertificate() {
  const pfxPath = path.resolve(__dirname, '..', 'windows', 'VsisTimesheetMobile.Package', 'VsisTimesheet_TemporaryKey.pfx');
  const cerPath = path.resolve(__dirname, '..', 'windows', 'VsisTimesheetMobile.Package', 'VsisTimesheet.cer');

  let needsRegen = !fs.existsSync(pfxPath);
  if (!needsRegen && fs.existsSync(cerPath)) {
    const checkScript = [
      `$c = Get-PfxCertificate '${cerPath.replace(/\\/g, '\\\\')}'`,
      `$hasBC = ($c.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' } | Measure-Object).Count -gt 0`,
      `if (-not $hasBC) { exit 1 }`,
    ].join('; ');
    const res = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', checkScript]);
    if (res.status !== 0) {
      needsRegen = true;
      try { fs.unlinkSync(pfxPath); } catch {}
      try { fs.unlinkSync(cerPath); } catch {}
    }
  }

  if (needsRegen) {
    console.log('Generating development code signing certificate (CN=VSIS with Basic Constraints & Code Signing)...');
    const psScript = [
      `$certPassword = ConvertTo-SecureString 'VsisTimesheet2026!' -AsPlainText -Force`,
      `$cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=VSIS' -KeyUsage DigitalSignature -FriendlyName 'VSIS Timesheet Dev Certificate' -CertStoreLocation 'Cert:\\CurrentUser\\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')`,
      `Export-PfxCertificate -Cert $cert -FilePath '${pfxPath.replace(/\\/g, '\\\\')}' -Password $certPassword | Out-Null`,
      `Export-Certificate -Cert $cert -FilePath '${cerPath.replace(/\\/g, '\\\\')}' | Out-Null`,
    ].join('; ');

    const res = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
      stdio: 'inherit',
    });
    if (res.error || res.status !== 0) {
      console.warn('Warning: Could not create temporary certificate automatically.');
    }
  }

  return { pfxPath, cerPath, password: 'VsisTimesheet2026!' };
}

const msbuildPath = findMSBuild();
console.log(`Using MSBuild: ${msbuildPath}`);

const cert = ensureCertificate();
const slnPath = path.resolve(__dirname, '..', 'windows', 'VsisTimesheetMobile.sln');
const args = [
  slnPath,
  '/p:Configuration=Release',
  '/p:Platform=x64',
  '/p:UseExperimentalNuget=true',
  '/p:RnwNewArch=true',
  '/p:AppxPackageSigningEnabled=true',
  `/p:PackageCertificateKeyFile=${cert.pfxPath}`,
  `/p:PackageCertificatePassword=${cert.password}`,
  '/p:BuildAppxUploadPackageForUap=false',
  '/p:UapAppxPackageBuildMode=SideloadOnly',
];

const result = spawnSync(msbuildPath, args, {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
