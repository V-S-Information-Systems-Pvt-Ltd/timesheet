# Secure token storage spike (WP-00)

Status: **adapter boundary and all three native modules implemented; native
build evidence still pending** for Android, iOS, and Windows. Production
session persistence must not ship until each row in the evidence table below
is filled in.

## Chosen adapter boundary

The app depends on one interface (`mobile/src/platform/secure-storage/types.ts`):

```ts
interface SecureTokenStore {
  read(): Promise<StoredTokens | null>;
  write(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}
```

`StoredTokens` carries the refresh token, the server-side session id, and the
approved base URL. Nothing else is persisted: access tokens stay in memory and
passwords are never stored.

Every platform exposes the same JS contract through one native module name,
`VsisSecureStorage`, with three methods:

```ts
set(service: string, key: string, value: string): Promise<boolean>;
get(service: string, key: string): Promise<string | null>;
remove(service: string, key: string): Promise<boolean>;
```

The adapters serialize the session payload into a single opaque value stored
under service `com.vsis.timesheet`, account key `mobile-refresh-token`. A
corrupt or unreadable payload is dropped (fail closed to signed-out), never
logged.

## Platform implementations

| Platform | Native module source | OS backing |
| --- | --- | --- |
| Android | `mobile/android/app/src/main/java/com/vsis/timesheet/VsisSecureStorageModule.kt` (+ `VsisSecureStoragePackage.kt`, registered in `MainApplication.kt`) | AES-256/GCM payload encrypted with a non-exportable key generated inside `AndroidKeyStore`; only IV + ciphertext are persisted in app-private storage |
| iOS | local pod `mobile/ios/VsisSecureStorage/` (wired via `Podfile`; no pbxproj edits needed) | Keychain generic-password item with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` — never synced or backed up |
| Windows | header-only module `mobile/windows/VsisTimesheetMobile/VsisSecureStorage.h`, included by `VsisTimesheetMobile.cpp` so the template's `CompReactPackageProvider` registers it | `Windows.Security.Credentials.PasswordVault` credential (device-local) |

Behavioural rules shared by every implementation:

- `get` resolves `null` for missing entries and silently deletes corrupt ones
  instead of wedging cold start.
- `set` overwrites atomically (Keychain update-or-add / vault retrieve-update /
  Keystore rewrite) and rejects when the OS write fails.
- No key material, plaintext, or error text containing secrets is returned to
  JS or written to logs.

## Fail-closed behaviour

`createSecureTokenStore(platform)` throws `SecureStorageUnavailableError` when
the platform has no OS-backed module. There is deliberately **no in-memory
fallback in production**: `App.tsx` renders a fatal screen instead of falling
back to plaintext storage. The `MemoryTokenStore` in
`mobile/src/auth/token-store.ts` exists for Jest tests and local wiring only.

## Rejected alternatives

- `react-native-keychain` - mature Keychain/Keystore support but no maintained
  Windows implementation that compiles against RNW 0.84; adopting it would
  still require a custom Windows module, so it adds a dependency without
  covering the third target.
- `@react-native-async-storage/async-storage` - plain app storage, not an OS
  credential locker; fails the threat model for long-lived refresh tokens.
- Storing tokens in SQLite/files - same objection as AsyncStorage.
- Supabase/local session persistence in JS - the client must not hold web
  cookie sessions or service credentials at all.
- Editing the generated `AutolinkedNativeModules.g.cpp` / `project.pbxproj` -
  both files are build-generated; the chosen integration points (app-project
  package provider on Windows, Podfile pod on iOS, `PackageList` add on
  Android) avoid them entirely.

## Evidence table (WP-00 exit)

| Target | Build command / pipeline | Result | Date |
| --- | --- | --- | --- |
| Android | `eas build -p android --profile preview` with a debug screen exercising write/read/delete | pending | - |
| iOS | `pod install` + `eas build -p ios` and an installed smoke on a registered device/TestFlight | pending | - |
| Windows | `npm run windows:release` (module is compiled into the app via `VsisSecureStorage.h`) | pending | - |

JS-level behaviour is covered by `mobile/__tests__/secure-token-store.test.ts`
(round-trip, corrupt-payload recovery, failed-write rejection, fail-closed
selection).
