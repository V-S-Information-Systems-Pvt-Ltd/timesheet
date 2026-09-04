const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function getPathValue(env) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  return pathKey ? env[pathKey] || '' : '';
}

function getPowerShellCandidates(env) {
  const pathEntries = getPathValue(env)
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  const pathCandidates = pathEntries.map((entry) => path.join(entry, 'pwsh.exe'));

  const programFiles = [...new Set([
    env.ProgramW6432,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ].filter(Boolean))];

  return [
    ...pathCandidates,
    ...programFiles.map((root) => path.join(root, 'PowerShell', '7', 'pwsh.exe')),
  ];
}

function findPowerShellCore(env = process.env, fileSystem = fs) {
  return getPowerShellCandidates(env).find((candidate) => fileSystem.existsSync(candidate)) ?? null;
}

function withPowerShellOnPath(env, fileSystem = fs) {
  if (process.platform !== 'win32') return env;

  const pwsh = findPowerShellCore(env, fileSystem);
  if (!pwsh) {
    throw new Error(
      `PowerShell 7 (pwsh.exe) is required for React Native Windows bundling. Checked: ${getPowerShellCandidates(env).join('; ')}`
    );
  }

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
  const currentPath = env[pathKey] ?? '';
  const pwshDirectory = path.dirname(pwsh);
  const hasDirectory = currentPath
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
    .some((entry) => path.resolve(entry).toLowerCase() === path.resolve(pwshDirectory).toLowerCase());
  const updatedPath = hasDirectory
    ? currentPath
    : [pwshDirectory, currentPath].filter(Boolean).join(path.delimiter);
  return { ...env, [pathKey]: updatedPath, Path: updatedPath, PATH: updatedPath };
}

function runBundle() {
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
}

module.exports = { findPowerShellCore, getPathValue, getPowerShellCandidates, withPowerShellOnPath };

if (require.main === module) runBundle();
