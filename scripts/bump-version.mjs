#!/usr/bin/env node

/**
 * scripts/bump-version.mjs
 * Synchronized version incrementer across all web, mobile, Android, and Windows manifests.
 *
 * Usage:
 *   node scripts/bump-version.mjs [patch | minor | major | X.Y.Z]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export function parseSemVer(versionStr) {
  const clean = versionStr.trim().replace(/^v/, '');
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    throw new Error(`Invalid semver format: "${versionStr}". Expected X.Y.Z or X.Y.Z-prerelease`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
  };
}

export function computeNextVersion(currentVersion, action = 'patch') {
  const cleanAction = String(action || 'patch').trim().replace(/^v/, '');
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(cleanAction)) {
    return cleanAction;
  }

  const { major, minor, patch } = parseSemVer(currentVersion);

  switch (cleanAction.toLowerCase()) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

function updateJsonFile(filePath, updater) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(raw);
  updater(json);
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8');
}

export function bumpAll(actionArg = 'patch', explicitCode = null) {
  const rootPackageJsonPath = path.join(rootDir, 'package.json');
  const rootPackageLockJsonPath = path.join(rootDir, 'package-lock.json');
  const mobilePackageJsonPath = path.join(rootDir, 'mobile', 'package.json');
  const mobilePackageLockJsonPath = path.join(rootDir, 'mobile', 'package-lock.json');
  const mobileAppJsonPath = path.join(rootDir, 'mobile', 'app.json');
  const androidBuildGradlePath = path.join(rootDir, 'mobile', 'android', 'app', 'build.gradle');
  const windowsManifestPath = path.join(
    rootDir,
    'mobile',
    'windows',
    'VsisTimesheetMobile.Package',
    'Package.appxmanifest'
  );
  const iosProjectPath = path.join(rootDir, 'mobile', 'ios', 'mobile.xcodeproj', 'project.pbxproj');
  const versionTsPath = path.join(rootDir, 'lib', 'version.ts');

  const rootPkg = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8'));
  const currentVersion = rootPkg.version || '0.2.1';
  const nextVersion = computeNextVersion(currentVersion, actionArg);

  console.log(`Bumping version: ${currentVersion} -> ${nextVersion} (action: ${actionArg})`);

  // 1. Root package.json
  updateJsonFile(rootPackageJsonPath, (json) => {
    json.version = nextVersion;
  });
  console.log(`✓ Updated ${path.relative(rootDir, rootPackageJsonPath)}`);

  // 2. Root package-lock.json
  updateJsonFile(rootPackageLockJsonPath, (json) => {
    json.version = nextVersion;
    if (json.packages && json.packages['']) {
      json.packages[''].version = nextVersion;
    }
  });
  console.log(`✓ Updated ${path.relative(rootDir, rootPackageLockJsonPath)}`);

  // 3. Mobile package.json
  updateJsonFile(mobilePackageJsonPath, (json) => {
    json.version = nextVersion;
  });
  console.log(`✓ Updated ${path.relative(rootDir, mobilePackageJsonPath)}`);

  // 4. Mobile package-lock.json
  updateJsonFile(mobilePackageLockJsonPath, (json) => {
    json.version = nextVersion;
    if (json.packages && json.packages['']) {
      json.packages[''].version = nextVersion;
    }
  });
  console.log(`✓ Updated ${path.relative(rootDir, mobilePackageLockJsonPath)}`);

  // 5. Compute next build code (shared by Android versionCode and iOS buildNumber)
  let nextCode = 1;
  if (explicitCode !== null && explicitCode !== undefined) {
    const parsed = parseInt(String(explicitCode), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`Invalid explicit build code: "${explicitCode}". Expected a non-negative integer.`);
    }
    nextCode = parsed;
  } else if (fs.existsSync(androidBuildGradlePath)) {
    const gradleContent = fs.readFileSync(androidBuildGradlePath, 'utf8');
    const match = gradleContent.match(/versionCode\s+(\d+)/);
    if (match) {
      nextCode = parseInt(match[1], 10) + 1;
    }
  }

  // 6. Mobile app.json
  updateJsonFile(mobileAppJsonPath, (json) => {
    json.version = nextVersion;
    if (!json.android) json.android = {};
    json.android.versionCode = nextCode;
    if (!json.ios) json.ios = {};
    json.ios.buildNumber = String(nextCode);
  });
  console.log(`✓ Updated ${path.relative(rootDir, mobileAppJsonPath)} (versionCode: ${nextCode}, buildNumber: "${nextCode}")`);

  // 7. Android build.gradle
  if (fs.existsSync(androidBuildGradlePath)) {
    let gradleContent = fs.readFileSync(androidBuildGradlePath, 'utf8');
    gradleContent = gradleContent.replace(/versionCode\s+(\d+)/, `versionCode ${nextCode}`);
    gradleContent = gradleContent.replace(/versionName\s+"[^"]+"/, `versionName "${nextVersion}"`);
    fs.writeFileSync(androidBuildGradlePath, gradleContent, 'utf8');
    console.log(`✓ Updated ${path.relative(rootDir, androidBuildGradlePath)} (versionCode: ${nextCode}, versionName: "${nextVersion}")`);
  }

  // 7. Windows Package.appxmanifest
  if (fs.existsSync(windowsManifestPath)) {
    let manifestContent = fs.readFileSync(windowsManifestPath, 'utf8');
    const parsed = parseSemVer(nextVersion);
    const fourPartVersion = `${parsed.major}.${parsed.minor}.${parsed.patch}.0`;
    manifestContent = manifestContent.replace(
      /(<Identity[^>]*Version=")[^"]*(")/,
      `$1${fourPartVersion}$2`
    );
    fs.writeFileSync(windowsManifestPath, manifestContent, 'utf8');
    console.log(`✓ Updated ${path.relative(rootDir, windowsManifestPath)} (Version="${fourPartVersion}")`);
  }

  // 8. iOS Xcode project
  if (fs.existsSync(iosProjectPath)) {
    let iosContent = fs.readFileSync(iosProjectPath, 'utf8');
    iosContent = iosContent.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${nextCode};`);
    iosContent = iosContent.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${nextVersion};`);
    fs.writeFileSync(iosProjectPath, iosContent, 'utf8');
    console.log(`✓ Updated ${path.relative(rootDir, iosProjectPath)} (build: ${nextCode}, marketing: "${nextVersion}")`);
  }

  // 9. Server version module (lib/version.ts)
  fs.writeFileSync(
    versionTsPath,
    `// Auto-generated by scripts/bump-version.mjs\nexport const APP_VERSION = '${nextVersion}'\n`,
    'utf8'
  );
  console.log(`✓ Updated ${path.relative(rootDir, versionTsPath)} (APP_VERSION = '${nextVersion}')`);

  console.log(`\nSuccessfully bumped all manifests to v${nextVersion}!`);
  return nextVersion;
}

if (process.argv[1] === __filename) {
  const action = process.argv[2] || 'patch';
  const explicitCode = process.argv[3] || null;
  bumpAll(action, explicitCode);
}
