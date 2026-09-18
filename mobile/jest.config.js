// Pin test mode before anything loads: a developer shell with
// NODE_ENV=production makes React ship production builds where `act` is
// stripped, breaking every renderer test (mirrors vitest.config.mts).
process.env.NODE_ENV = 'test';

module.exports = {
  preset: 'react-native',
  // Shared packages are consumed from TypeScript sources (file: dependencies
  // symlink to ../packages); map directly so Babel transforms them even though
  // they resolve outside the mobile root.
  moduleNameMapper: {
    '^@vsis/core$': '<rootDir>/../packages/core/src/index.ts',
    '^@vsis/contracts$': '<rootDir>/../packages/contracts/src/index.ts',
    '^@vsis/client$': '<rootDir>/../packages/client/src/index.ts',
    // Sources outside the mobile root resolve Babel helpers from the repo
    // root, which has no @babel/runtime; pin them to the mobile installation.
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
  },
};
