const { msbuildFailed } = require('../scripts/package-windows.js');

describe('Windows packaging MSBuild failure detection', () => {
  it('accepts a clean exit with an empty errors log', () => {
    expect(msbuildFailed({ status: 0 }, '\r\n')).toBe(false);
  });

  it('fails on logged errors even when MSBuild exits 0', () => {
    expect(msbuildFailed({ status: 0 }, 'MakeAppx : error : Package creation failed.')).toBe(true);
  });

  it('fails on a non-zero, missing, or spawn-error result', () => {
    expect(msbuildFailed({ status: 1 }, '')).toBe(true);
    expect(msbuildFailed({ status: null }, '')).toBe(true);
    expect(msbuildFailed({ status: null, error: new Error('ENOENT') }, '')).toBe(true);
  });
});
