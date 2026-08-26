import { MemoryTokenStore } from './memory';
import type { SecureTokenStore } from './types';

export * from './types';
export * from './memory';

export function createTokenStore(): SecureTokenStore {
  return new MemoryTokenStore();
}

export const defaultTokenStore: SecureTokenStore = createTokenStore();
