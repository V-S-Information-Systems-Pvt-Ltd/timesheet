#!/usr/bin/env node

/**
 * mobile/scripts/package-android.js
 * Builds Android Release APK and copies the generated binary to mobile/build/android/
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const mobileDir = path.resolve(__dirname, '..');
const androidDir = path.join(mobileDir, 'android');
const appJsonPath = path.join(mobileDir, 'app.json');

const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const version = appJson.version || '0.2.2';

console.log(`\n========================================`);
console.log(` Building Android Release APK (v${version})`);
console.log(`========================================\n`);

const isWindows = process.platform === 'win32';
const gradlewCmd = isWindows ? 'gradlew.bat' : './gradlew';
const gradlewPath = path.join(androidDir, gradlewCmd);

if (!fs.existsSync(gradlewPath)) {
  console.error(`Error: gradlew executable not found at ${gradlewPath}`);
  process.exit(1);
}

const buildResult = spawnSync(gradlewPath, ['assembleRelease', '--no-daemon'], {
  cwd: androidDir,
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

if (buildResult.error) {
  console.error('Android build failed:', buildResult.error);
  process.exit(1);
}

if (buildResult.status !== 0) {
  console.error(`Android build exited with error code ${buildResult.status}`);
  process.exit(buildResult.status ?? 1);
}

// Post-build: Copy binary to mobile/build/android/
const sourceApkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const targetBuildDir = path.join(mobileDir, 'build', 'android');

if (!fs.existsSync(sourceApkPath)) {
  console.error(`Error: Output APK not found at ${sourceApkPath}`);
  process.exit(1);
}

fs.mkdirSync(targetBuildDir, { recursive: true });

const targetReleaseApk = path.join(targetBuildDir, 'app-release.apk');
const targetVersionedApk = path.join(targetBuildDir, `vsis-timesheet-v${version}.apk`);

fs.copyFileSync(sourceApkPath, targetReleaseApk);
fs.copyFileSync(sourceApkPath, targetVersionedApk);

console.log(`\n========================================`);
console.log(`✓ Android build artifacts successfully copied to:`);
console.log(`  - ${targetReleaseApk}`);
console.log(`  - ${targetVersionedApk}`);
console.log(`========================================\n`);

process.exit(0);
