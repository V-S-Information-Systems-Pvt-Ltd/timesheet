#!/usr/bin/env node

/**
 * mobile/scripts/collect-binaries.js
 * Gathers all built Android APKs and Windows MSIX packages into mobile/build/
 */

const fs = require('fs');
const path = require('path');

const mobileDir = path.resolve(__dirname, '..');
const appJsonPath = path.join(mobileDir, 'app.json');

const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const version = appJson.version || '0.2.2';

console.log(`\nCollecting build binaries for v${version} into mobile/build/...`);

const targetBuildDir = path.join(mobileDir, 'build');
const androidTargetDir = path.join(targetBuildDir, 'android');
const windowsTargetDir = path.join(targetBuildDir, 'windows');

fs.mkdirSync(androidTargetDir, { recursive: true });
fs.mkdirSync(windowsTargetDir, { recursive: true });

// 1. Android APK
const androidApk = path.join(mobileDir, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (fs.existsSync(androidApk)) {
  fs.copyFileSync(androidApk, path.join(androidTargetDir, 'app-release.apk'));
  fs.copyFileSync(androidApk, path.join(androidTargetDir, `vsis-timesheet-v${version}.apk`));
  console.log(`✓ Android APK copied to ${androidTargetDir}`);
} else {
  console.log(`- No Android release APK found at ${androidApk}`);
}

// 2. Windows MSIX
const appPackagesDir = path.join(mobileDir, 'windows', 'VsisTimesheetMobile.Package', 'AppPackages');
if (fs.existsSync(appPackagesDir)) {
  const entries = fs.readdirSync(appPackagesDir).filter((e) =>
    fs.statSync(path.join(appPackagesDir, e)).isDirectory()
  );
  const matching = entries.find((e) => e.includes(version)) || entries.sort().reverse()[0];
  if (matching) {
    const sourcePkgDir = path.join(appPackagesDir, matching);
    fs.cpSync(sourcePkgDir, windowsTargetDir, { recursive: true });
    console.log(`✓ Windows package copied to ${windowsTargetDir}`);
  }
} else {
  console.log(`- No Windows AppPackages found at ${appPackagesDir}`);
}

console.log(`\nBinary collection complete: ${targetBuildDir}\n`);
