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
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files\\Microsoft Visual Studio\\18\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\MSBuild\\Current\\Bin\\MSBuild.exe',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\MSBuild\\Current\\Bin\\MSBuild.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  throw new Error('MSBuild.exe could not be found. Please ensure Visual Studio or Build Tools is installed.');
}

function getPowerShellCmd() {
  try {
    const res = spawnSync('pwsh.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout.trim()) return 'pwsh.exe';
  } catch {}
  return 'powershell.exe';
}

function ensureCertificate() {
  const certPassword = process.env.WINDOWS_SIGNING_PASSWORD || process.env.CERT_PASSWORD;
  if (!certPassword) {
    throw new Error(
      'WINDOWS_SIGNING_PASSWORD is required to package and sign the Windows application. ' +
      'Please set WINDOWS_SIGNING_PASSWORD in your terminal environment or local secret manager before running package:windows.'
    );
  }

  const customPfx = process.env.WINDOWS_CERT_PATH;
  if (customPfx && fs.existsSync(customPfx)) {
    return { pfxPath: customPfx, cerPath: '', password: certPassword, thumbprint: '' };
  }

  const pfxPath = path.resolve(__dirname, '..', 'windows', 'VsisTimesheetMobile.Package', 'VsisTimesheet_TemporaryKey.pfx');
  const cerPath = path.resolve(__dirname, '..', 'windows', 'VsisTimesheetMobile.Package', 'VsisTimesheet.cer');
  const psEnv = { ...process.env, VSIS_TEMP_CERT_PASSWORD: certPassword };
  const psExecutable = getPowerShellCmd();

  let thumbprint = '';
  // Check if existing certificate can be read with current password
  let needsRegen = true;
  if (fs.existsSync(pfxPath)) {
    const testScript = [
      `$p = '${pfxPath.replace(/'/g, "''")}'`,
      `$sec = ConvertTo-SecureString $env:VSIS_TEMP_CERT_PASSWORD -AsPlainText -Force`,
      `try {`,
      `  $pfx = Get-PfxData -FilePath $p -Password $sec`,
      `  if ($pfx.EndEntityCertificates.Count -gt 0) {`,
      `    Write-Output $pfx.EndEntityCertificates[0].Thumbprint`,
      `  } else { exit 1 }`,
      `} catch { exit 1 }`,
    ].join('; ');
    const testRes = spawnSync(psExecutable, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', testScript], {
      env: psEnv,
      encoding: 'utf8',
    });
    if (testRes.status === 0 && testRes.stdout.trim()) {
      thumbprint = testRes.stdout.trim().split(/\r?\n/)[0].trim();
      needsRegen = false;
    } else {
      try { fs.unlinkSync(pfxPath); } catch {}
      try { fs.unlinkSync(cerPath); } catch {}
    }
  }

  if (needsRegen) {
    console.log('Generating development code signing certificate (CN=VSIS with Basic Constraints & Code Signing)...');
    const psScript = [
      `$certPassword = ConvertTo-SecureString $env:VSIS_TEMP_CERT_PASSWORD -AsPlainText -Force`,
      `$cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=VSIS' -KeyUsage DigitalSignature -FriendlyName 'VSIS Timesheet Dev Certificate' -CertStoreLocation 'Cert:\\CurrentUser\\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')`,
      `try {`,
      `  Export-PfxCertificate -Cert $cert -FilePath '${pfxPath.replace(/'/g, "''")}' -Password $certPassword -CryptoAlgorithmOption TripleDES_SHA1 | Out-Null`,
      `} catch {`,
      `  Export-PfxCertificate -Cert $cert -FilePath '${pfxPath.replace(/'/g, "''")}' -Password $certPassword | Out-Null`,
      `}`,
      `Export-Certificate -Cert $cert -FilePath '${cerPath.replace(/'/g, "''")}' | Out-Null`,
      `Write-Output $cert.Thumbprint`,
    ].join('; ');

    const res = spawnSync(psExecutable, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
      env: psEnv,
      encoding: 'utf8',
    });
    if (res.status === 0 && res.stdout.trim()) {
      thumbprint = res.stdout.trim().split(/\r?\n/).pop().trim();
    }
    if (res.error || res.status !== 0 || !res.stdout.trim()) {
      console.warn('Warning: Could not create temporary certificate automatically.', res.stderr || res.error);
    }
  }

  return { pfxPath, cerPath, password: certPassword, thumbprint };
}

const msbuildPath = findMSBuild();
console.log(`Using MSBuild: ${msbuildPath}`);

const cert = ensureCertificate();
console.log(`Certificate configured: ${cert.pfxPath} (Thumbprint: ${cert.thumbprint || 'N/A'})`);
const slnPath = path.resolve(__dirname, '..', 'windows', 'VsisTimesheetMobile.sln');
const args = [
  slnPath,
  '/restore',
  '/p:Configuration=Release',
  '/p:Platform=x64',
  '/p:UseExperimentalNuget=true',
  '/p:RnwNewArch=true',
  '/p:AppxPackageSigningEnabled=true',
  `/p:PackageCertificateKeyFile=${cert.pfxPath}`,
  '/p:BuildAppxUploadPackageForUap=false',
  '/p:UapAppxPackageBuildMode=SideloadOnly',
];

if (cert.thumbprint) {
  args.push(`/p:PackageCertificateThumbprint=${cert.thumbprint}`);
}

const nugetRoot = process.env.NUGET_PACKAGES || path.join(process.env.USERPROFILE || process.env.HOME || '', '.nuget', 'packages');
if (fs.existsSync(nugetRoot)) {
  args.push(`/p:NuGetPackageRoot=${nugetRoot}\\`);
  const hermesExe = path.join(nugetRoot, 'microsoft.javascript.hermes', '0.0.0-2605.6002-2279da22', 'tools', 'native', 'release', 'x86', 'hermes.exe');
  if (fs.existsSync(hermesExe)) {
    args.push(`/p:HermesCompilerCommand=${hermesExe}`);
  }
}

const result = spawnSync(msbuildPath, args, {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env: {
    ...process.env,
    PackageCertificatePassword: cert.password,
  },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.status === 0) {
  try {
    const appJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'app.json'), 'utf8'));
    const version = appJson.version || '0.2.2';
    const appPackagesDir = path.resolve(__dirname, '..', 'windows', 'VsisTimesheetMobile.Package', 'AppPackages');
    const targetBuildDir = path.resolve(__dirname, '..', 'build', 'windows');
    fs.mkdirSync(targetBuildDir, { recursive: true });

    if (fs.existsSync(appPackagesDir)) {
      const entries = fs.readdirSync(appPackagesDir).filter(e => fs.statSync(path.join(appPackagesDir, e)).isDirectory());
      const matching = entries.find(e => e.includes(version)) || entries.sort().reverse()[0];
      if (matching) {
        const sourcePkgDir = path.join(appPackagesDir, matching);
        fs.cpSync(sourcePkgDir, targetBuildDir, { recursive: true });
        console.log(`\n✓ Windows release binaries successfully copied to: ${targetBuildDir}`);
      }
    }
  } catch (err) {
    console.warn('Warning: Could not copy Windows binaries to mobile/build/windows:', err.message);
  }
}

process.exit(result.status ?? 0);
