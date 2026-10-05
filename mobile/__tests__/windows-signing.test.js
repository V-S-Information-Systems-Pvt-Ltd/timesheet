const { resolveSigningThumbprint } = require('../scripts/windows-signing');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

describe('Windows signing certificate selection', () => {
  const leaf = 'E97C8B433863F60C12A0E2D01E7B09C470BB4ADF';
  const options = { pfxPath: "C:\\PKI\\app's signing.pfx", password: 'test-secret-never-log', manifestPath: 'C:\\app\\Package.appxmanifest', env: { SystemRoot: 'C:\\Windows' } };

  it('reads metadata without importing certificates and returns the selected leaf thumbprint', () => {
    const run = jest.fn(() => ({ status: 0, stdout: `${leaf}\r\n` }));
    expect(resolveSigningThumbprint({ ...options, run })).toBe(leaf);
    const [command, args, child] = run.mock.calls[0];
    expect(command).toContain('WindowsPowerShell');
    expect(args.join(' ')).not.toContain(options.password);
    expect(args.join(' ')).not.toContain(options.pfxPath);
    expect(args[args.length - 1]).toContain('Get-PfxData');
    expect(args[args.length - 1]).toContain('CertificateAuthority');
    expect(args[args.length - 1]).toContain('1.3.6.1.5.5.7.3.3');
    expect(args[args.length - 1]).not.toContain('Import-PfxCertificate');
    expect(child.env.VSIS_SIGNING_PASSWORD).toBe(options.password);
    expect(child.env.VSIS_SIGNING_PFX_PATH).toBe(options.pfxPath);
    expect(child.windowsHide).toBe(true);
  });

  it('normalizes an explicit thumbprint and refuses a different selection', () => {
    const run = jest.fn(() => ({ status: 0, stdout: leaf.toLowerCase() }));
    expect(resolveSigningThumbprint({ ...options, thumbprint: ` ${leaf.toLowerCase()} `, run })).toBe(leaf);
    expect(run.mock.calls[0][2].env.VSIS_SIGNING_THUMBPRINT).toBe(leaf);
    run.mockReturnValue({ status: 0, stdout: 'A'.repeat(40) });
    expect(() => resolveSigningThumbprint({ ...options, thumbprint: leaf, run })).toThrow('selection failed');
  });

  it('rejects malformed operator input before reading the PFX', () => {
    const run = jest.fn();
    expect(() => resolveSigningThumbprint({ ...options, thumbprint: 'invalid', run })).toThrow('40-character');
    expect(run).not.toHaveBeenCalled();
  });

  it('sanitizes process startup exceptions', () => {
    const run = () => { throw new Error(options.password); };
    expect(() => resolveSigningThumbprint({ ...options, run })).toThrow('Cannot start signing certificate inspection');
    try { resolveSigningThumbprint({ ...options, run }); } catch (error) {
      expect(error.message).not.toContain(options.password);
    }
  });

  it.each([
    ['PFX_READ_FAILED', 'opened or decrypted'],
    ['INITIALIZATION_FAILED', 'built-in PKI'],
    ['PUBLISHER_MISMATCH', 'Subject matches'],
    ['CODE_SIGNING_USAGE_MISSING', 'Code Signing EKU'],
    ['THUMBPRINT_MISMATCH', 'stale setting'],
    ['AMBIGUOUS_SIGNER', 'Multiple eligible'],
  ])('reports the safe category %s without forwarding extra output', (code, message) => {
    const run = () => ({ status: 1, stdout: '', stderr: JSON.stringify({ code, certificates: 2, matches: 0, publisherMatches: options.password, secret: options.password }) });
    expect(() => resolveSigningThumbprint({ ...options, run })).toThrow(message);
    try { resolveSigningThumbprint({ ...options, run }); } catch (error) {
      expect(error.message).toContain(`[${code}]`);
      expect(error.message).toContain('certificates=2');
      expect(error.message).not.toContain(options.password);
    }
  });

  it('ignores unknown diagnostic codes and raw exception text', () => {
    const run = () => ({ status: 1, stdout: '', stderr: JSON.stringify({ code: options.password }) });
    expect(() => resolveSigningThumbprint({ ...options, run })).toThrow('selection failed');
    try { resolveSigningThumbprint({ ...options, run }); } catch (error) {
      expect(error.message).not.toContain(options.password);
    }
  });

  it('identifies timeouts without forwarding their raw error text', () => {
    const run = () => ({ status: null, stdout: '', error: Object.assign(new Error(options.password), { code: 'ETIMEDOUT' }) });
    expect(() => resolveSigningThumbprint({ ...options, run })).toThrow('timed out after 30 seconds');
  });

  it.each([
    { status: 1, stdout: '', stderr: 'ambiguous certificates' },
    { status: 0, stdout: 'not-a-thumbprint' },
    { status: 0, stdout: `${leaf}\n${'A'.repeat(40)}` },
    { status: null, stdout: '', error: new Error('test-secret-never-log') },
  ])('refuses failed or ambiguous results without leaking process diagnostics', (result) => {
    const run = jest.fn(() => ({ ...result, stderr: options.password }));
    expect(() => resolveSigningThumbprint({ ...options, run })).toThrow('selection failed');
    try { resolveSigningThumbprint({ ...options, run }); } catch (error) {
      expect(error.message).not.toContain(options.password);
    }
  });
});

describe('Windows packaging signer integration', () => {
  const leaf = 'E97C8B433863F60C12A0E2D01E7B09C470BB4ADF';
  const scriptDir = path.resolve(__dirname, '../scripts');
  const source = fs.readFileSync(path.join(scriptDir, 'package-windows.js'), 'utf8');

  function packageWith({ unsigned = false, select = jest.fn(() => leaf) } = {}) {
    const build = jest.fn(() => ({ status: 1 }));
    const env = { WINDOWS_CERT_PATH: 'C:\\PKI\\app.pfx', WINDOWS_SIGNING_PASSWORD: 'test-secret-never-log' };
    const execute = () => vm.runInNewContext(source, {
      __dirname: scriptDir,
      process: { platform: 'win32', env, argv: unsigned ? ['node', 'package-windows.js', '--unsigned'] : ['node', 'package-windows.js'], exit: jest.fn() },
      console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      require: (name) => {
        if (name === 'child_process') return { execSync: () => 'C:\\MSBuild.exe', spawnSync: build };
        if (name === 'fs') return { existsSync: () => true };
        if (name === 'path') return path;
        if (name === './windows-signing') return { resolveSigningThumbprint: select };
        throw new Error(`Unexpected module: ${name}`);
      },
    });
    return { execute, build, select, env };
  }

  it('passes the selected leaf to MSBuild while keeping the password out of arguments', () => {
    const { execute, build, select, env } = packageWith();
    execute();
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ pfxPath: env.WINDOWS_CERT_PATH, password: env.WINDOWS_SIGNING_PASSWORD }));
    const [, args, options] = build.mock.calls[0];
    expect(args).toContain(`/p:PackageCertificateThumbprint=${leaf}`);
    expect(args).toContain(`/p:PackageCertificateKeyFile=${env.WINDOWS_CERT_PATH}`);
    expect(args.join(' ')).not.toContain(env.WINDOWS_SIGNING_PASSWORD);
    expect(options.env.PackageCertificatePassword).toBe(env.WINDOWS_SIGNING_PASSWORD);
  });

  it('bypasses certificate inspection for unsigned packages', () => {
    const { execute, build, select } = packageWith({ unsigned: true });
    execute();
    expect(select).not.toHaveBeenCalled();
    expect(build.mock.calls[0][1]).toContain('/p:AppxPackageSigningEnabled=false');
    expect(build.mock.calls[0][1].some(arg => arg.includes('PackageCertificateThumbprint'))).toBe(false);
  });

  it('does not build when the signer cannot be selected', () => {
    const select = jest.fn(() => { throw new Error('ambiguous signing certificate'); });
    const { execute, build } = packageWith({ select });
    expect(execute).toThrow('ambiguous signing certificate');
    expect(build).not.toHaveBeenCalled();
  });
});

const describeOnWindows = process.platform === 'win32' ? describe : describe.skip;
describeOnWindows('PowerShell certificate filtering', () => {
  const leaf = 'E97C8B433863F60C12A0E2D01E7B09C470BB4ADF';
  const certificate = ({ ca = false, subject = 'CN=VSIS', codeSigning = true, thumbprint = leaf } = {}) => ({
    Subject: subject,
    Thumbprint: thumbprint,
    Extensions: [
      { Oid: { Value: '2.5.29.19' }, CertificateAuthority: ca },
      { Oid: { Value: '2.5.29.37' }, EnhancedKeyUsages: [{ Value: codeSigning ? '1.3.6.1.5.5.7.3.3' : '1.3.6.1.5.5.7.3.1' }] },
    ],
  });
  function inspect(certificates, thumbprint = '') {
    return resolveSigningThumbprint({
      pfxPath: 'metadata-fixture.pfx', password: 'fixture-password', thumbprint,
      manifestPath: path.resolve(__dirname, '../windows/VsisTimesheetMobile.Package/Package.appxmanifest'),
      run: (command, args, options) => {
        // Substitute metadata only; execute the production filtering code in real PowerShell.
        const stub = 'function Get-PfxData { param($FilePath, $Password) [pscustomobject]@{EndEntityCertificates=(ConvertFrom-Json $env:VSIS_SIGNING_TEST_CERTS)} }\n';
        const commandArgs = [...args];
        commandArgs[commandArgs.length - 1] = stub + commandArgs[commandArgs.length - 1];
        return spawnSync(command, commandArgs, { ...options, env: { ...options.env, VSIS_SIGNING_TEST_CERTS: JSON.stringify(certificates) } });
      },
    });
  }

  it('selects the matching leaf and excludes CA, other-publisher and other-EKU certificates', () => {
    expect(inspect([certificate({ ca: true }), certificate({ subject: 'CN=Other' }), certificate({ codeSigning: false }), certificate()])).toBe(leaf);
  });

  it('rejects an ambiguous pair and accepts an explicit leaf pin', () => {
    const pair = [certificate(), certificate({ thumbprint: 'A'.repeat(40) })];
    expect(() => inspect(pair)).toThrow('selection failed');
    expect(inspect(pair, leaf)).toBe(leaf);
  });

  it('rejects a chain with no eligible app signer', () => {
    expect(() => inspect([certificate({ ca: true }), certificate({ subject: 'CN=Other' }), certificate({ codeSigning: false })])).toThrow('selection failed');
  });

  it('identifies a stale thumbprint and missing Code Signing usage in real PowerShell', () => {
    expect(() => inspect([certificate()], 'A'.repeat(40))).toThrow('[THUMBPRINT_MISMATCH]');
    expect(() => inspect([certificate({ codeSigning: false })])).toThrow('[CODE_SIGNING_USAGE_MISSING]');
  });
});
