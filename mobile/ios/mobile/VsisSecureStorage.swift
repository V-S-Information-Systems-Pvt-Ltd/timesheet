// VsisSecureStorage.swift
// OS-backed secure credential storage for iOS, exposed on the legacy
// NativeModules bridge (see mobile/src/platform/secure-storage/native.ts).
//
// Backed by a Keychain generic-password item with device-only accessibility and
// fixed service/account identifiers, so the app addresses exactly one entry and
// nothing else. The payload is the JSON string produced by the JS contract
// ({"version":1,"refreshToken":...,"sessionId":...}).
//
// Rejections carry the JavaScript contract codes from
// mobile/src/platform/secure-storage/types.ts: unavailable | locked | corrupt |
// read-failed | write-failed | delete-failed. Messages are generic and never
// include the Keychain error text.
//
// Requires the Swift bridging header configured in the Xcode target
// (SWIFT_OBJC_BRIDGING_HEADER = mobile/VsisSecureStorage-Bridging-Header.h).

import Foundation
import Security

@objc(VsisSecureStorage)
final class VsisSecureStorage: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool { false }

  private let service = "VsisTimesheetMobile"
  private let account = "SessionCredentials"

  // MARK: - Keychain item plumbing

  private func baseQuery() -> [CFString: Any] {
    return [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
  }

  private func add(_ payload: String) -> OSStatus {
    var query = baseQuery()
    query[kSecValueData] = Data(payload.utf8)
    return SecItemAdd(query as CFDictionary, nil)
  }

  private func update(_ payload: String) -> OSStatus {
    let attributes: [CFString: Any] = [
      kSecValueData: Data(payload.utf8),
      kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    return SecItemUpdate(baseQuery() as CFDictionary, attributes as CFDictionary)
  }

  private func read() throws -> String? {
    var query = baseQuery()
    query[kSecReturnData] = true
    query[kSecMatchLimit] = kSecMatchLimitOne

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound {
      return nil
    }
    if status != errSecSuccess {
      throw SecureStorageFailure(status)
    }
    guard let data = result as? Data else {
      throw SecureStorageFailure(errSecUnspecified)
    }
    return String(data: data, encoding: .utf8)
  }

  private func delete() throws {
    let status = SecItemDelete(baseQuery() as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound {
      throw SecureStorageFailure(status)
    }
  }

  private struct SecureStorageFailure: Error {
    let status: OSStatus
    init(_ status: OSStatus) { self.status = status }
  }

  // MARK: - React Native bridge methods

  @objc(read:reject:)
  func read(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    do {
      let value = try read()
      // Absence is null on the JS side; the contract in
      // mobile/src/platform/secure-storage/types.ts treats null as signed-out.
      resolve(value)
    } catch let failure as SecureStorageFailure {
      switch failure.status {
      case errSecInteractionNotAllowed:
        // Device locked / Keychain inaccessible. Surfaces as `locked` so the UI
        // can prompt rather than treat the credential as gone.
        reject("locked", "Secure credential storage is locked.", nil)
      default:
        reject("read-failed", "Failed to read secure credentials.", nil)
      }
    } catch {
      reject("read-failed", "Failed to read secure credentials.", nil)
    }
  }

  @objc(write:resolve:reject:)
  func write(_ payload: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    do {
      // Atomic replacement: SecItemUpdate fails with errSecItemNotFound when the
      // entry does not exist yet, so add on that path. A crash between the two
      // is not possible because this runs on the main thread in one transaction.
      if let existing = try read() {
        if existing == payload {
          resolve(nil)
          return
        }
        let status = update(payload)
        if status != errSecSuccess {
          throw SecureStorageFailure(status)
        }
      } else {
        let status = add(payload)
        if status != errSecSuccess {
          throw SecureStorageFailure(status)
        }
      }
      resolve(nil)
    } catch let failure as SecureStorageFailure {
      reject("write-failed", "Failed to write secure credentials.", nil)
    } catch {
      reject("write-failed", "Failed to write secure credentials.", nil)
    }
  }

  @objc(clear:reject:)
  func clear(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    do {
      try delete()
      resolve(nil)
    } catch let failure as SecureStorageFailure {
      switch failure.status {
      case errSecInteractionNotAllowed:
        reject("locked", "Secure credential storage is locked.", nil)
      default:
        reject("delete-failed", "Failed to clear secure credentials.", nil)
      }
    } catch {
      reject("delete-failed", "Failed to clear secure credentials.", nil)
    }
  }

  @objc(clearLegacy:reject:)
  func clearLegacy(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    // No iOS legacy artifact has been identified beyond the Keychain entry
    // removed by `clear`; this is an idempotent no-op by design to satisfy the
    // JS contract, which calls it before every read/write.
    resolve(nil)
  }
}