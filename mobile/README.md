# VSIS Timesheet Mobile

React Native 0.84.1 client with a React Native for Windows 0.84.0 target.
Android and iOS release builds are intended to run through EAS Build; the
Windows target uses the React Native Windows CLI.

## Local development

From this directory:

```powershell
npm ci
npm start
npm run typecheck
npm run lint
npm test
```

Windows commands:

```powershell
npm run windows
npm run windows:release
```

The Windows target requires the React Native Windows toolchain: Visual Studio
2022 C++/UWP workloads, a compatible Windows SDK, the .NET SDK, and PowerShell
7 (`pwsh.exe`). `npm run bundle:windows` locates a standard PowerShell 7
installation under Program Files and adds it to the bundler child process only.
Android Studio is not required for the planned cloud-build workflow.

## Cloud builds

Install or invoke the EAS CLI from this directory. The profiles are in
`eas.json`:

```powershell
npx eas-cli@latest build --platform android --profile development
npx eas-cli@latest build --platform ios --profile development
npx eas-cli@latest build --platform all --profile production
```

Before submitting a build, validate the native preparation locally (this does
not upload source code):

```powershell
$out = Join-Path $env:TEMP 'vsis-eas-android-prebuild'
npx eas-cli@latest build:inspect --platform android --profile preview --stage pre-build --output $out --force
Remove-Item -LiteralPath $out -Recurse -Force
```

The Android package is `com.vsis.timesheet`; the iOS bundle identifier is
`com.vsis.timesheetmobile`. Signed builds use remote EAS credentials. The first
store build may require Google Play and Apple Developer account access. Do not
commit credentials or environment secrets.

## Current implementation slice

- The native shell and design tokens are in `App.tsx` and `src/theme.ts`.
- `src/api/client.ts` provides the typed HTTP foundation.
- `/api/v1/config` is the first server bootstrap endpoint; authentication and
  data endpoints are added in subsequent implementation phases.
