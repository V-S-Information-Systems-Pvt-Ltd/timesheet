// VsisSecureStorage.h : PasswordVault-backed secure storage module for the
// VSIS mobile session. Values live as Windows.Security.Credentials
//.PasswordVault credentials (device-local); no plaintext token is written to
// ordinary app storage.
//
// JS contract (NativeModules.VsisSecureStorage):
//   set(service, key, value) -> Promise<boolean>
//   get(service, key)        -> Promise<string | null>
//   remove(service, key)     -> Promise<boolean>
#pragma once

#include "pch.h"

#include "NativeModules.h"

#include <string>

#include <winrt/Windows.Security.Credentials.h>

namespace winrt::VsisTimesheetMobile {

namespace {
constexpr wchar_t kVaultResource[] = L"com.vsis.timesheet";

winrt::hstring AccountFor(const std::string &service, const std::string &key) {
  // One credential per service/key pair keeps lookups unambiguous.
  return winrt::to_hstring(service + "." + key);
}
} // namespace

REACT_MODULE(VsisSecureStorage)
struct VsisSecureStorage {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &) noexcept {}

  REACT_METHOD(set)
  void set(
      std::string service,
      std::string key,
      std::string value,
      winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept try {
    using namespace winrt::Windows::Security::Credentials;
    PasswordVault vault;
    auto resource = winrt::to_hstring(kVaultResource);
    auto account = AccountFor(service, key);

    // PasswordVault has no Update; replace any existing entry.
    try {
      auto existing = vault.Retrieve(resource, account);
      if (existing) {
        vault.Remove(existing);
      }
    } catch (...) {
      // Not present yet; fall through.
    }
    vault.Add(PasswordCredential(resource, account, winrt::to_hstring(value)));
    promise.Resolve(true);
  } catch (...) {
    promise.Reject(L"Secure storage write failed.");
  }

  REACT_METHOD(get)
  void get(
      std::string service,
      std::string key,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept try {
    using namespace winrt::Windows::Security::Credentials;
    PasswordVault vault;
    auto resource = winrt::to_hstring(kVaultResource);
    try {
      auto existing = vault.Retrieve(resource, AccountFor(service, key));
      if (existing) {
        promise.Resolve(winrt::Microsoft::ReactNative::JSValue(winrt::to_string(existing.Password())));
        return;
      }
    } catch (...) {
      // Missing credentials resolve to null like the other platforms.
    }
    promise.Resolve(winrt::Microsoft::ReactNative::JSValue());
  } catch (...) {
    // Corrupt/unreadable entries are reported as absent so cold start recovers.
    promise.Resolve(winrt::Microsoft::ReactNative::JSValue());
  }

  REACT_METHOD(remove)
  void remove(
      std::string service,
      std::string key,
      winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    using namespace winrt::Windows::Security::Credentials;
    try {
      PasswordVault vault;
      auto resource = winrt::to_hstring(kVaultResource);
      try {
        auto existing = vault.Retrieve(resource, AccountFor(service, key));
        if (existing) {
          vault.Remove(existing);
          promise.Resolve(true);
          return;
        }
      } catch (...) {
        // Not present.
      }
      promise.Resolve(false);
    } catch (...) {
      promise.Reject(L"Secure storage delete failed.");
    }
  }
};

} // namespace winrt::VsisTimesheetMobile
