const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findPowerShellCore() {
  const programFiles = [...new Set([
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ].filter(Boolean))];

  for (const root of programFiles) {
    const candidate = path.join(root, 'PowerShell', '7', 'pwsh.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function withPowerShellOnPath(env) {
  if (process.platform !== 'win32') return env;

  const pwsh = findPowerShellCore();
  if (!pwsh) {
    throw new Error(
      'PowerShell 7 (pwsh.exe) is required for React Native Windows bundling. Install it or add pwsh.exe to PATH.'
    );
  }

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
  const currentPath = env[pathKey] ?? '';
  const updatedPath = [path.dirname(pwsh), currentPath].filter(Boolean).join(path.delimiter);
  return { ...env, [pathKey]: updatedPath, Path: updatedPath, PATH: updatedPath };
}

const cliPath = path.resolve(__dirname, '..', 'node_modules', 'react-native', 'cli.js');
const bundleArgs = [
  cliPath,
  'bundle',
  '--platform',
  'windows',
  '--entry-file',
  'index.js',
  '--bundle-output',
  'windows/VsisTimesheetMobile/Bundle/index.windows.bundle',
  '--assets-dest',
  'windows/VsisTimesheetMobile/Bundle',
  '--dev',
  'false',
];

try {
  const result = spawnSync(process.execPath, bundleArgs, {
    cwd: path.resolve(__dirname, '..'),
    env: withPowerShellOnPath(process.env),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
