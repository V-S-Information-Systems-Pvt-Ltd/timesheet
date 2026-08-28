# VSIS Release and Versioning Policy

## 1. Overview and Core Philosophy

This policy defines the versioning, branching, tagging, and build increment rules for the VSIS Timesheet application across both its Web/Cloud-Native backend and Cross-Platform React Native mobile applications (Android, iOS, and Windows).

All components adhere strictly to **Semantic Versioning 2.0.0 (SemVer)**:
`MAJOR.MINOR.PATCH` (e.g., `0.2.0`)

---

## 2. The Every-Build Patch Increment Policy

To ensure strict traceability between binary artifacts (MSIX, APK/AAB, Docker containers) and Git commits, **every release build must increment the PATCH version**.

| Release Type | Version Segment | Trigger / Condition | Example |
| :--- | :--- | :--- | :--- |
| **Breaking Change** | `MAJOR` (`X.0.0`) | Incompatible API contract break, major breaking schema migration, or dropped platform support. | `0.2.0` → `1.0.0` |
| **Feature Release** | `MINOR` (`x.Y.0`) | New backward-compatible feature, new screen, or new backend endpoint. Resets PATCH to `0`. | `0.2.0` → `0.3.0` |
| **Build / Patch Release** | `PATCH` (`x.y.Z`) | **Every release package build**, security hardening update, or backward-compatible bug fix. | `0.2.0` → `0.2.1` |

---

## 3. Synchronized Manifest Matrix

Whenever a version is bumped, the following 6 configuration files must be updated synchronously in a single atomic commit:

| Manifest | Target File | Parameter / Format |
| :--- | :--- | :--- |
| **Root Web Application** | [package.json](file:///c:/dev/timesheet-mobile/package.json) | `"version": "X.Y.Z"` |
| **Root Lockfile** | [package-lock.json](file:///c:/dev/timesheet-mobile/package-lock.json) | `"version": "X.Y.Z"` (packages[""]) |
| **Mobile Package** | [mobile/package.json](file:///c:/dev/timesheet-mobile/mobile/package.json) | `"version": "X.Y.Z"` |
| **Mobile App Config** | [mobile/app.json](file:///c:/dev/timesheet-mobile/mobile/app.json) | `"version": "X.Y.Z"` |
| **Android Build Manifest** | [mobile/android/app/build.gradle](file:///c:/dev/timesheet-mobile/mobile/android/app/build.gradle) | `versionName "X.Y.Z"`<br>`versionCode <incremented-integer>` |
| **Windows AppX Manifest** | [mobile/windows/VsisTimesheetMobile.Package/Package.appxmanifest](file:///c:/dev/timesheet-mobile/mobile/windows/VsisTimesheetMobile.Package/Package.appxmanifest) | `<Identity ... Version="X.Y.Z.0" />` |

---

## 4. Automated Version Bumping Workflow

The project provides an automated, idempotent Node.js script: [scripts/bump-version.js](file:///c:/dev/timesheet-mobile/scripts/bump-version.js).

### Commands

```bash
# Increment patch level version (default): 0.2.0 -> 0.2.1
npm run version:bump
# Or explicitly:
npm run version:patch

# Increment minor level version: 0.2.1 -> 0.3.0
npm run version:minor

# Increment major level version: 0.3.0 -> 1.0.0
npm run version:major

# Set an explicit arbitrary version:
node scripts/bump-version.js 0.2.5
```

---

## 5. Release Build Procedures

### A. Android Release (APK / AAB)
1. Run patch bump: `npm run version:patch`
2. Build release bundle/APK:
   ```bash
   cd mobile/android
   ./gradlew assembleRelease --no-daemon
   ```
3. Artifact generated: `mobile/android/app/build/outputs/apk/release/app-release.apk`

### B. Windows Release (MSIX / Sideload Package)
1. Run patch bump: `npm run version:patch`
2. Set signing secret in terminal session:
   ```powershell
   $env:WINDOWS_SIGNING_PASSWORD = "YourSigningPassword"
   ```
3. Build signed package:
   ```bash
   cd mobile
   npm run package:windows
   ```
4. Artifact generated: `mobile/windows/VsisTimesheetMobile.Package/AppPackages/VsisTimesheetMobile.Package_<VERSION>_x64_Test/`

---

## 6. Git Tagging & Release Commits

1. Commit version bumps using conventional commit format:
   ```bash
   git commit -am "chore(release): v0.2.1"
   ```
2. Create an annotated Git tag:
   ```bash
   git tag -a v0.2.1 -m "Release v0.2.1"
   ```
3. Push to remote:
   ```bash
   git push origin <branch> --follow-tags
   ```
