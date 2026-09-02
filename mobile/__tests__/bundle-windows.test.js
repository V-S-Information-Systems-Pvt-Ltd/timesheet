const { findPowerShellCore, withPowerShellOnPath } = require('../scripts/bundle-windows.js');

describe('Windows bundler PowerShell discovery', () => {
  it('prefers pwsh.exe found on PATH', () => {
    const env = { Path: 'C:\\custom\\PowerShell;C:\\Windows\\System32' };
    const existing = new Set(['C:\\custom\\PowerShell\\pwsh.exe']);
    const fileSystem = { existsSync: (candidate) => existing.has(candidate) };

    expect(findPowerShellCore(env, fileSystem)).toBe('C:\\custom\\PowerShell\\pwsh.exe');
  });

  it('falls back to the standard Program Files location', () => {
    const env = { ProgramW6432: 'D:\\Apps' };
    const existing = new Set(['D:\\Apps\\PowerShell\\7\\pwsh.exe']);
    const fileSystem = { existsSync: (candidate) => existing.has(candidate) };

    expect(findPowerShellCore(env, fileSystem)).toBe('D:\\Apps\\PowerShell\\7\\pwsh.exe');
  });

  it('handles quoted, empty, and case-varied PATH entries', () => {
    const env = { PATH: '"C:\\custom\\PowerShell";;C:\\Windows\\System32' };
    const existing = new Set(['C:\\custom\\PowerShell\\pwsh.exe']);
    const fileSystem = { existsSync: (candidate) => existing.has(candidate) };

    expect(findPowerShellCore(env, fileSystem)).toBe('C:\\custom\\PowerShell\\pwsh.exe');
  });

  it('does not duplicate a PowerShell directory already on PATH', () => {
    const env = { Path: 'C:\\custom\\PowerShell;C:\\Windows\\System32' };
    const existing = new Set(['C:\\custom\\PowerShell\\pwsh.exe']);
    const fileSystem = { existsSync: (candidate) => existing.has(candidate) };

    expect(withPowerShellOnPath(env, fileSystem).Path).toBe(env.Path);
  });

  it('returns null when no PowerShell executable is available', () => {
    expect(findPowerShellCore({ Path: 'C:\\missing' }, { existsSync: () => false })).toBeNull();
  });
});
