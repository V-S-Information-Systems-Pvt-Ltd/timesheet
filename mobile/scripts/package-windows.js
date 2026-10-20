const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { resolveSigningThumbprint } = require('./windows-signing');
const { loadEnvDefaults } = require('./load-env');

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

// --store builds an unsigned .msixupload for Partner Center; the Store signs it.
const isStore = process.argv.includes('--store');
const isUnsigned = isStore || process.argv.includes('--unsigned') || process.env.UNSIGNED === 'true';

// Product identity reserved in Partner Center (Product management > Product identity).
const STORE_IDENTITY = {
  name: 'Chankramana.VSISTimesheet',
  publisher: 'CN=2A7C6BEE-D22A-4DA5-8BBF-B4199C13DFAD',
  publisherDisplayName: 'Chankramana',
  displayName: 'VSIS Timesheet',
};
const manifestPath = path.resolve(__dirname, '..', 'windows', 'VsisTimesheetMobile.Package', 'Package.appxmanifest');

function toStoreManifest(xml) {
  const out = xml
    .replace(/(<Identity\s[^>]*?Name=")[^"]*"/, `$1${STORE_IDENTITY.name}"`)
    .replace(/(<Identity\s[^>]*?Publisher=")[^"]*"/, `$1${STORE_IDENTITY.publisher}"`)
    .replace(/<PublisherDisplayName>[^<]*</, `<PublisherDisplayName>${STORE_IDENTITY.publisherDisplayName}<`)
    .replace(/<DisplayName>[^<]*</, `<DisplayName>${STORE_IDENTITY.displayName}<`)
    .replace(/(<uap:VisualElements\s[^>]*?DisplayName=")[^"]*"/, `$1${STORE_IDENTITY.displayName}"`);
  for (const v of [STORE_IDENTITY.name, STORE_IDENTITY.publisher]) {
    if (!out.includes(`"${v}"`)) throw new Error(`Could not apply Store identity to ${manifestPath}`);
  }
  return out;
}

function ensureCertificate() {
  loadEnvDefaults(process.env);
  const certPassword = process.env.WINDOWS_SIGNING_PASSWORD || process.env.CERT_PASSWORD;
  if (!certPassword) {
    throw new Error(
      'WINDOWS_SIGNING_PASSWORD is required to package and sign the Windows application. ' +
      'Please set WINDOWS_SIGNING_PASSWORD in your terminal environment or local secret manager before running package:windows, ' +
      'or pass --unsigned (npm run package:windows:unsigned) for local verification without signing.'
    );
  }

  let customPfx = process.env.WINDOWS_CERT_PATH;
  if (customPfx && fs.existsSync(customPfx) && fs.statSync && typeof fs.statSync === 'function') {
    try {
      if (fs.statSync(customPfx).isDirectory()) {
        const candidate = path.join(customPfx, 'VSIS-AppSigning.pfx');
        if (fs.existsSync(candidate)) {
          customPfx = candidate;
        }
      }
    } catch {}
  }
  if (!customPfx || !fs.existsSync(customPfx)) {
    throw new Error(
      'WINDOWS_CERT_PATH must point to the permanent production PFX for a signed Windows package. ' +
      'Temporary/self-signed certificates are not permitted; pass --unsigned for local verification.'
    );
  }

  const thumbprint = resolveSigningThumbprint({
    pfxPath: customPfx,
    password: certPassword,
    manifestPath,
    thumbprint: process.env.WINDOWS_CERT_THUMBPRINT || '',
  });
  return { pfxPath: customPfx, cerPath: '', password: certPassword, thumbprint };
}

const msbuildPath = findMSBuild();
console.log(`Using MSBuild: ${msbuildPath}`);

let cert = null;
if (isUnsigned) {
  console.log(isStore
    ? 'Packaging for the Microsoft Store (--store). The Store signs the package; local signing is disabled.'
    : 'Packaging in UNSIGNED mode (--unsigned). Certificate signing is disabled.');
} else {
  cert = ensureCertificate();
  console.log(`Certificate configured: ${cert.pfxPath} (Thumbprint: ${cert.thumbprint || 'N/A'})`);
}

const slnPath = path.resolve(__dirname, '..', 'windows', 'VsisTimesheetMobile.sln');
const args = [
  slnPath,
  '/restore',
  '/p:Configuration=Release',
  '/p:Platform=x64',
  '/p:UseExperimentalNuget=true',
  '/p:RnwNewArch=true',
  `/p:AppxPackageSigningEnabled=${isUnsigned ? 'false' : 'true'}`,
  `/p:BuildAppxUploadPackageForUap=${isStore}`,
  `/p:UapAppxPackageBuildMode=${isStore ? 'StoreUpload' : 'SideloadOnly'}`,
];

if (cert && cert.pfxPath) {
  args.push(`/p:PackageCertificateKeyFile=${cert.pfxPath}`);
  if (cert.thumbprint) {
    args.push(`/p:PackageCertificateThumbprint=${cert.thumbprint}`);
  }
}

const nugetRoot = process.env.NUGET_PACKAGES || path.join(process.env.USERPROFILE || process.env.HOME || '', '.nuget', 'packages');
if (fs.existsSync(nugetRoot)) {
  args.push(`/p:NuGetPackageRoot=${nugetRoot}\\`);
  const hermesExe = path.join(nugetRoot, 'microsoft.javascript.hermes', '0.0.0-2605.6002-2279da22', 'tools', 'native', 'release', 'x86', 'hermes.exe');
  if (fs.existsSync(hermesExe)) {
    args.push(`/p:HermesCompilerCommand=${hermesExe}`);
  }
}

const buildEnv = { ...process.env };
if (cert && cert.password) {
  buildEnv.PackageCertificatePassword = cert.password;
}

// ponytail: the Store identity is patched into the checked-in manifest for the
// build and restored afterwards; a hard kill mid-build leaves it modified (git shows it).
const originalManifest = isStore ? fs.readFileSync(manifestPath, 'utf8') : null;
if (isStore) {
  fs.writeFileSync(manifestPath, toStoreManifest(originalManifest));
}
let result;
try {
  result = spawnSync(msbuildPath, args, {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    env: buildEnv,
  });
} finally {
  if (isStore) fs.writeFileSync(manifestPath, originalManifest);
}

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.status === 0 && isStore) {
  const appJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'app.json'), 'utf8'));
  const appPackagesDir = path.resolve(__dirname, '..', 'windows', 'VsisTimesheetMobile.Package', 'AppPackages');
  const uploadName = `VsisTimesheetMobile.Package_${appJson.version}.0_x64.msixupload`;
  const source = path.join(appPackagesDir, uploadName);
  if (!fs.existsSync(source)) {
    console.error(`Error: Store upload package not found: ${source}`);
    process.exit(1);
  }
  const targetDir = path.resolve(__dirname, '..', 'build', 'windows-store');
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, `vsis-timesheet-v${appJson.version}-x64.msixupload`);
  fs.copyFileSync(source, target);
  console.log(`
✓ Microsoft Store upload package: ${target}`);
} else if (result.status === 0) {
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
