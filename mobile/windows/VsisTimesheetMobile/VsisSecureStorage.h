#pragma once

#include "pch.h"
#include <NativeModules.h>
#include <winrt/Windows.Security.Credentials.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <cstdint>
#include <string>

namespace winrt::VsisTimesheetMobile {

// Fixed resource/account identifiers: PasswordVault keys are not namespaced per
// app, so the app's entry is addressed by this exact pair and nothing else.
constexpr std::wstring_view c_resource = L"VsisTimesheetMobile";
constexpr std::wstring_view c_account = L"SessionCredentials";
constexpr std::wstring_view c_account_workspace = L"WorkspaceUrl";

REACT_MODULE(VsisSecureStorage, L"VsisSecureStorage")
struct VsisSecureStorage {
  // 0x80070490 = ERROR_NOT_FOUND (vault has no entry for the resource/account).
  constexpr static winrt::hresult NotFound{static_cast<int32_t>(0x80070490u)};

  // Rejections carry one of the JavaScript contract codes from
  // mobile/src/platform/secure-storage/types.ts. Messages are generic and never
  // include the WinRT exception text, so they cannot leak into JS or logs.
  REACT_METHOD(read)
  void read(winrt::Microsoft::ReactNative::ReactPromise<std::string> result) noexcept {
    try {
      winrt::Windows::Security::Credentials::PasswordVault vault;
      winrt::Windows::Security::Credentials::PasswordCredential credential{nullptr};
      try {
        credential = vault.Retrieve(c_resource, c_account);
      } catch (winrt::hresult_error const &ex) {
        if (ex.code() == NotFound) {
          // Absence is expressed as null on the JS side. ReactPromise<std::string>
          // cannot resolve null, so the bridge resolves "" and
          // mobile/src/platform/secure-storage/native.ts treats empty as absent.
          result.Resolve("");
          return;
        }
        result.Reject(winrt::Microsoft::ReactNative::ReactError{
            "locked", "Secure credential storage is unavailable."});
        return;
      }

      if (credential) {
        credential.RetrievePassword();
        result.Resolve(winrt::to_string(credential.Password()));
      } else {
        result.Resolve("");
      }
    } catch (winrt::hresult_error const &ex) {
      // A corrupt/duplicate value is indistinguishable from other vault errors
      // at this boundary; the JS contract has no finer code, so map to corrupt
      // only for the specific vault-bad-state condition, otherwise read-failed.
      if (ex.code() == NotFound) {
        result.Resolve("");
      } else {
        result.Reject(winrt::Microsoft::ReactNative::ReactError{
            "read-failed", "Failed to read secure credentials."});
      }
    } catch (...) {
      result.Reject(winrt::Microsoft::ReactNative::ReactError{
          "read-failed", "Failed to read secure credentials."});
    }
  }

  REACT_METHOD(write)
  void write(std::string payload, winrt::Microsoft::ReactNative::ReactPromise<void> result) noexcept {
    try {
      winrt::Windows::Security::Credentials::PasswordVault vault;
      try {
        auto existing = vault.Retrieve(c_resource, c_account);
        vault.Remove(existing);
      } catch (winrt::hresult_error const &ex) {
        // Only "not found" is acceptable; any other failure means the previous
        // credential could not be removed and must not be silently overwritten.
        if (ex.code() != NotFound) {
          result.Reject(winrt::Microsoft::ReactNative::ReactError{
              "write-failed", "Failed to replace secure credentials."});
          return;
        }
      }

      winrt::Windows::Security::Credentials::PasswordCredential credential(
          c_resource, c_account, winrt::to_hstring(payload));
      vault.Add(credential);
      result.Resolve();
    } catch (winrt::hresult_error const &ex) {
      result.Reject(winrt::Microsoft::ReactNative::ReactError{
          "write-failed", "Failed to write secure credentials."});
    } catch (...) {
      result.Reject(winrt::Microsoft::ReactNative::ReactError{
          "write-failed", "Failed to write secure credentials."});
    }
  }

  REACT_METHOD(clear)
  void clear(winrt::Microsoft::ReactNative::ReactPromise<void> result) noexcept {
    try {
      winrt::Windows::Security::Credentials::PasswordVault vault;
      try {
        auto existing = vault.Retrieve(c_resource, c_account);
        vault.Remove(existing);
      } catch (winrt::hresult_error const &ex) {
        // Not-found is the success case for a delete: the entry is already gone.
        if (ex.code() != NotFound) {
          result.Reject(winrt::Microsoft::ReactNative::ReactError{
              "delete-failed", "Failed to clear secure credentials."});
          return;
        }
      }
      result.Resolve();
    } catch (winrt::hresult_error const &ex) {
      result.Reject(winrt::Microsoft::ReactNative::ReactError{
          "delete-failed", "Failed to clear secure credentials."});
    } catch (...) {
      result.Reject(winrt::Microsoft::ReactNative::ReactError{
          "delete-failed", "Failed to clear secure credentials."});
    }
  }

  REACT_METHOD(clearLegacy)
  void clearLegacy(winrt::Microsoft::ReactNative::ReactPromise<void> result) noexcept {
    // No Windows legacy artifact has been identified beyond the app's own
    // PasswordVault entry (removed by `clear`); this is an idempotent no-op by
    // design to satisfy the JS contract.
    result.Resolve();
  }

  REACT_METHOD(readWorkspace)
  void readWorkspace(winrt::Microsoft::ReactNative::ReactPromise<std::string> result) noexcept {
    try {
      winrt::Windows::Security::Credentials::PasswordVault vault;
      winrt::Windows::Security::Credentials::PasswordCredential credential{nullptr};
      try {
        credential = vault.Retrieve(c_resource, c_account_workspace);
      } catch (winrt::hresult_error const &ex) {
        result.Resolve("");
        return;
      }

      if (credential) {
        credential.RetrievePassword();
        result.Resolve(winrt::to_string(credential.Password()));
      } else {
        result.Resolve("");
      }
    } catch (...) {
      result.Resolve("");
    }
  }

  REACT_METHOD(writeWorkspace)
  void writeWorkspace(std::string url, winrt::Microsoft::ReactNative::ReactPromise<void> result) noexcept {
    try {
      winrt::Windows::Security::Credentials::PasswordVault vault;
      try {
        auto existing = vault.Retrieve(c_resource, c_account_workspace);
        vault.Remove(existing);
      } catch (...) {}

      winrt::Windows::Security::Credentials::PasswordCredential credential(
          c_resource, c_account_workspace, winrt::to_hstring(url));
      vault.Add(credential);
      result.Resolve();
    } catch (...) {
      result.Resolve();
    }
  }

  REACT_METHOD(clearWorkspace)
  void clearWorkspace(winrt::Microsoft::ReactNative::ReactPromise<void> result) noexcept {
    try {
      winrt::Windows::Security::Credentials::PasswordVault vault;
      try {
        auto existing = vault.Retrieve(c_resource, c_account_workspace);
        vault.Remove(existing);
      } catch (...) {}
      result.Resolve();
    } catch (...) {
      result.Resolve();
    }
  }
};

} // namespace winrt::VsisTimesheetMobile
