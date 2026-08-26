// RNW is an out-of-tree platform and the shared rnx-kit preset does not expose
// it to Jest in this app. Keep a dedicated Windows command so CI can run the
// shared unit suite on a Windows runner without requiring a native build.
module.exports = {
  preset: 'react-native',
};
