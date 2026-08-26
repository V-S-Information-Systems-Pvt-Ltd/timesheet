// VsisSecureStorage.mm — Keychain-backed secure storage for the VSIS mobile
// session. Values are stored as generic-password items with device-only
// accessibility (kSecAttrAccessibleWhenUnlockedThisDeviceOnly); they are
// never included in iCloud backups and never leave the device keychain.
//
// JS contract (NativeModules.VsisSecureStorage):
//   set(service, key, value) -> Promise<boolean>
//   get(service, key)        -> Promise<string | null>
//   remove(service, key)     -> Promise<boolean>

#import <Security/Security.h>

#if __has_include(<React/RCTBridgeModule.h>)
#import <React/RCTBridgeModule.h>
#elif __has_include("RCTBridgeModule.h")
#import "RCTBridgeModule.h"
#else
#import <React-Core/RCTBridgeModule.h>
#endif

static NSString * const kSecureStorageService = @"VsisSecureStorage";

static NSString * storageKey(NSString *service, NSString *key) {
  return [NSString stringWithFormat:@"%@.%@", service, key];
}

static NSDictionary * baseQuery(NSString *account) {
  return @{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    // Constant per-item service namespace; the account carries service.key.
    (__bridge id)kSecAttrService: kSecureStorageService,
    (__bridge id)kSecAttrAccount: account,
  };
}

@implementation VsisSecureStorage

RCT_EXPORT_MODULE(VsisSecureStorage)

RCT_EXPORT_METHOD(set:(NSString *)service
    key:(NSString *)key
    value:(NSString *)value
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    NSString *account = storageKey(service, key);
    NSData *valueData = [value dataUsingEncoding:NSUTF8StringEncoding];

    OSStatus status = SecItemUpdate(
        (__bridge CFDictionaryRef)baseQuery(account),
        (__bridge CFDictionaryRef)@{ (__bridge id)kSecValueData: valueData });

    if (status == errSecItemNotFound) {
      NSMutableDictionary *addition =
          [NSMutableDictionary dictionaryWithDictionary:baseQuery(account)];
      addition[(__bridge id)kSecValueData] = valueData;
      addition[(__bridge id)kSecAttrAccessible] =
          (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
      status = SecItemAdd((__bridge CFDictionaryRef)addition, NULL);
    }

    if (status == errSecSuccess) {
      resolve(@YES);
    } else {
      reject(@"SECURE_STORAGE_WRITE_FAILED",
             [NSString stringWithFormat:@"Keychain write failed with status %d.", (int)status],
             nil);
    }
  }
  @catch (NSException *exception) {
    reject(@"SECURE_STORAGE_WRITE_FAILED", exception.reason ?: @"Keychain write failed.", nil);
  }
}

RCT_EXPORT_METHOD(get:(NSString *)service
    key:(NSString *)key
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    NSString *account = storageKey(service, key);
    NSMutableDictionary *query =
        [NSMutableDictionary dictionaryWithDictionary:baseQuery(account)];
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecItemNotFound) {
      resolve([NSNull null]);
      return;
    }
    if (status != errSecSuccess || result == NULL) {
      // Unreadable items are dropped so a corrupt entry cannot wedge cold start.
      SecItemDelete((__bridge CFDictionaryRef)baseQuery(account));
      resolve([NSNull null]);
      return;
    }

    NSData *data = CFBridgingRelease(result);
    NSString *value = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (value == nil) {
      SecItemDelete((__bridge CFDictionaryRef)baseQuery(account));
      resolve([NSNull null]);
      return;
    }
    resolve(value);
  }
  @catch (NSException *exception) {
    reject(@"SECURE_STORAGE_READ_FAILED", exception.reason ?: @"Keychain read failed.", nil);
  }
}

RCT_EXPORT_METHOD(remove:(NSString *)service
    key:(NSString *)key
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    OSStatus status =
        SecItemDelete((__bridge CFDictionaryRef)baseQuery(storageKey(service, key)));
    resolve(status == errSecSuccess ? @YES : @NO);
  }
  @catch (NSException *exception) {
    reject(@"SECURE_STORAGE_REMOVE_FAILED", exception.reason ?: @"Keychain delete failed.", nil);
  }
}

@end
