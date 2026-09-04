# VSIS Release and Versioning Policy

## 1. Overview and Core Philosophy

This policy defines the versioning, branching, tagging, build increment, and binary packaging rules for the VSIS Timesheet application across both its Web/Cloud-Native backend and Cross-Platform React Native mobile applications (Android, iOS, and Windows).

All components adhere strictly to **Semantic Versioning 2.0.0 (SemVer)**:
`MAJOR.MINOR.PATCH` (e.g., `0.2.2`)

---

## 2. The Every-Build Patch Increment Policy

To ensure strict traceability between binary artifacts (MSIX, APK/AAB, Docker containers) and Git commits, **every release build must increment the PATCH version**.

| Release Type | Version Segment | Trigger / Condition | Example |
| :--- | :--- | :--- | :--- |
| **Breaking Change** | `MAJOR` (`X.0.0`) | Incompatible API contract break, major breaking schema migration, or dropped platform support. | `0.2.0` → `1.0.0` |
| **Feature Release** | `MINOR` (`x.Y.0`) | New backward-compatible feature, new screen, or new backend endpoint. Resets PATCH to `0`. | `0.2.0` → `0.3.0` |
| **Build / Patch Release** | `PATCH` (`x.y.Z`) | **Every release package build**, security hardening update, or backward-compatible bug fix. | `0.2.1` → `0.2.2` |

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

## 4. Unified Binary Output Policy (`mobile/build/`)

All compiled release packages and installation bundles are automatically placed in the centralized **`mobile/build/`** folder:

```
mobile/build/
├── android/
│   ├── app-release.apk                     # Direct Gradle release APK
│   └── vsis-timesheet-v<VERSION>.apk       # Versioned release APK
└── windows/
    ├── VsisTimesheetMobile.Package_<VERSION>_x64.msix   # Signed sideloadable package
    ├── VsisTimesheetMobile.Package_<VERSION>_x64.cer    # Developer certificate
    ├── Install.ps1                                      # Automated PowerShell installer
    ├── Add-AppDevPackage.ps1                            # Developer mode package script
    └── Dependencies/                                    # VCLibs and WinUI runtime dependencies
```

---

## 5. Automated Release & Packaging Commands

All packaging commands automatically compile, sign (Windows), and copy the resulting binaries directly into `mobile/build/`:

```bash
# 1. Version Bump (required prior to release builds)
npm run version:patch              # Bumps X.Y.Z -> X.Y.(Z+1) across all manifests

# 2. Package Android Release
npm run package:android            # Compiles release APK and writes to mobile/build/android/

# 3. Package Windows Release
# Requires WINDOWS_SIGNING_PASSWORD in current terminal session:
$env:WINDOWS_SIGNING_PASSWORD = "YourSigningPassword"
npm run package:windows            # Compiles release MSIX and writes to mobile/build/windows/

# 4. Package All Platforms (Android + Windows)
npm run package:all                # Compiles and copies all binaries to mobile/build/

# 5. Collect Binaries on Demand
npm run collect:binaries           # Copies existing platform build outputs to mobile/build/
```

---

## 6. Git Tagging & Release Commits

1. Commit version bumps using conventional commit format:
   ```bash
   git commit -am "chore(release): v0.2.2"
   ```
2. Create an annotated Git tag:
   ```bash
   git tag -a v0.2.2 -m "Release v0.2.2"
   ```
3. Push to remote:
   ```bash
   git push origin <branch> --follow-tags
   ```
