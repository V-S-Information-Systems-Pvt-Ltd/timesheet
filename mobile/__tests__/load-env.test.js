const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvDefaults } = require('../scripts/load-env');

describe('loadEnvDefaults', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return file;
  };

  it('fills unset keys, strips matching quotes and skips comments and junk lines', () => {
    const file = write('.env.local', [
      '# signing',
      'ANDROID_KEY_ALIAS=release',
      'ANDROID_KEYSTORE_PATH="C:\\keys\\release.keystore"',
      "ANDROID_KEY_PASSWORD='p=ss'",
      'not a pair',
      '=novalue',
    ].join('\r\n'));
    const env = loadEnvDefaults({}, [file]);
    expect(env).toEqual({
      ANDROID_KEY_ALIAS: 'release',
      ANDROID_KEYSTORE_PATH: 'C:\\keys\\release.keystore',
      ANDROID_KEY_PASSWORD: 'p=ss',
    });
  });

  it('never overrides the shell, and the first file to set a key wins', () => {
    const first = write('.env.local', 'A=from-local\nB=from-local');
    const second = write('.env', 'B=from-env\nC=from-env');
    const env = loadEnvDefaults({ A: 'from-shell' }, [first, second]);
    expect(env).toEqual({ A: 'from-shell', B: 'from-local', C: 'from-env' });
  });

  it('skips files that do not exist', () => {
    expect(loadEnvDefaults({ A: '1' }, [path.join(dir, 'missing.env')])).toEqual({ A: '1' });
  });
});
