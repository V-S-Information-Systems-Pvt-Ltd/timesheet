# Secure-storage compatibility spike

Status: **pending native proof**

The mobile session design requires a platform-backed store for the refresh
token. The application layer must depend only on a `SecureTokenStore` adapter;
it must not write tokens to AsyncStorage, files, SQLite, Redux persistence, or
logs.

## Required evidence before WP-05

| Target | Required backing store | Evidence to attach |
| --- | --- | --- |
| Android | Android Keystore-backed credential store | EAS development/preview build installs and passes write/read/delete smoke test |
| iOS | Keychain generic-password item | EAS iOS build installs on a registered device or TestFlight and passes smoke test |
| Windows | Windows PasswordVault or an equivalent OS credential locker | Windows Debug/Release build passes the same smoke test |

The package/adapters are not selected yet. The agent implementing WP-05 must
record the exact package and version, native support matrix, entitlements or
permissions, failure behavior, and test/build evidence here before checking
the packet complete. If a dependency lacks maintained Windows support, keep the
shared interface and implement a small Windows native adapter instead.

## Security constraints

- Persist only the opaque refresh token and non-secret session metadata.
- Keep the access token in memory.
- Delete the stored token on logout, refresh-token reuse, revocation, or
  account-invalidation errors.
- Use device-only Keychain accessibility on iOS where supported.
- Do not require biometrics for the first implementation; make it an explicit
  later product decision.
- Never print credential values in build, test, analytics, or crash logs.

## References

- Android Keystore: https://developer.android.com/privacy-and-security/keystore
- Apple Keychain Services: https://developer.apple.com/documentation/security/keychain-services
- Windows PasswordVault: https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.passwordvault
