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
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semver format: "${versionStr}". Expected X.Y.Z`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

export function computeNextVersion(currentVersion, action = 'patch') {
  const { major, minor, patch } = parseSemVer(currentVersion);

  switch (action.toLowerCase()) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      if (/^\d+\.\d+\.\d+$/.test(action)) {
        return action;
      }
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

export function bumpAll(actionArg = 'patch') {
  const rootPackageJsonPath = path.join(rootDir, 'package.json');
  const rootPackageLockJsonPath = path.join(rootDir, 'package-lock.json');
  const mobilePackageJsonPath = path.join(rootDir, 'mobile', 'package.json');
  const mobileAppJsonPath = path.join(rootDir, 'mobile', 'app.json');
  const androidBuildGradlePath = path.join(rootDir, 'mobile', 'android', 'app', 'build.gradle');
  const windowsManifestPath = path.join(
    rootDir,
    'mobile',
    'windows',
    'VsisTimesheetMobile.Package',
    'Package.appxmanifest'
  );

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

  // 4. Mobile app.json
  updateJsonFile(mobileAppJsonPath, (json) => {
    json.version = nextVersion;
  });
  console.log(`✓ Updated ${path.relative(rootDir, mobileAppJsonPath)}`);

  // 5. Android build.gradle
  if (fs.existsSync(androidBuildGradlePath)) {
    let gradleContent = fs.readFileSync(androidBuildGradlePath, 'utf8');
    let nextCode = 1;
    gradleContent = gradleContent.replace(/versionCode\s+(\d+)/, (match, codeStr) => {
      nextCode = parseInt(codeStr, 10) + 1;
      return `versionCode ${nextCode}`;
    });
    gradleContent = gradleContent.replace(/versionName\s+"[^"]+"/, `versionName "${nextVersion}"`);
    fs.writeFileSync(androidBuildGradlePath, gradleContent, 'utf8');
    console.log(`✓ Updated ${path.relative(rootDir, androidBuildGradlePath)} (versionCode: ${nextCode}, versionName: "${nextVersion}")`);
  }

  // 6. Windows Package.appxmanifest
  if (fs.existsSync(windowsManifestPath)) {
    let manifestContent = fs.readFileSync(windowsManifestPath, 'utf8');
    const fourPartVersion = `${nextVersion}.0`;
    manifestContent = manifestContent.replace(
      /(<Identity[^>]*Version=")[^"]*(")/,
      `$1${fourPartVersion}$2`
    );
    fs.writeFileSync(windowsManifestPath, manifestContent, 'utf8');
    console.log(`✓ Updated ${path.relative(rootDir, windowsManifestPath)} (Version="${fourPartVersion}")`);
  }

  console.log(`\nSuccessfully bumped all manifests to v${nextVersion}!`);
  return nextVersion;
}

if (process.argv[1] === __filename) {
  const action = process.argv[2] || 'patch';
  bumpAll(action);
}
