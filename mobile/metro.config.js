const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const fs = require('fs');
const path = require('node:path');

const rnwPath = fs.realpathSync(
  path.resolve(require.resolve('react-native-windows/package.json'), '..'),
);

//

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */

const config = {
  // Shared @vsis/* packages are consumed from sources in the repo-level
  // packages/ directory; Metro must watch them or their edits go unbundled.
  watchFolders: [
    path.resolve(__dirname, '..', 'packages', 'core'),
    path.resolve(__dirname, '..', 'packages', 'contracts'),
    path.resolve(__dirname, '..', 'packages', 'client'),
  ],
  //
  resolver: {
    // Imports that originate inside the shared packages resolve from the
    // package source directory, outside Metro's watched node_modules; pin
    // them (and Babel runtime helpers) to the mobile-local installation so
    // no second React/native runtime can enter the graph.
    extraNodeModules: {
      '@babel/runtime': path.dirname(
        require.resolve('@babel/runtime/package.json', { paths: [__dirname] })
      ),
      '@vsis/core': path.resolve(__dirname, '..', 'packages', 'core'),
      '@vsis/contracts': path.resolve(__dirname, '..', 'packages', 'contracts'),
      '@vsis/client': path.resolve(__dirname, '..', 'packages', 'client'),
    },
    blockList: [
      // This stops "npx @react-native-community/cli run-windows" from causing the metro server to crash if its already running
      new RegExp(
        `${path.resolve(__dirname, 'windows').replace(/[/\\]/g, '/')}.*`,
      ),
      // This prevents "npx @react-native-community/cli run-windows" from hitting: EBUSY: resource busy or locked, open msbuild.ProjectImports.zip or other files produced by msbuild
      new RegExp(`${rnwPath}/build/.*`),
      new RegExp(`${rnwPath}/target/.*`),
      /.*\.ProjectImports\.zip/,
    ],
    //
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
