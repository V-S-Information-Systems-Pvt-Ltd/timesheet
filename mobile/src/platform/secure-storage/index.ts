import { NativeTokenStore } from './native';
import type { SecureTokenStore } from './types';

export * from './types';
export * from './native';

export function createTokenStore(): SecureTokenStore {
  return new NativeTokenStore();
}

export const defaultTokenStore: SecureTokenStore = createTokenStore();
