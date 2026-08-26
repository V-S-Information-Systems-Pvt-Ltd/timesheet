// Register React Native Windows only when the Windows CLI is in use. The
// Android/iOS autolinking command runs in EAS Linux/macOS builders, where the
// Windows CLI configuration can fail before Gradle evaluates the project.
module.exports =
  process.platform === 'win32'
    ? require('react-native-windows/react-native.config.js')
    : {};
