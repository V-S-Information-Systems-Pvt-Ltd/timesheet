import { DurableTokenStore } from './durable';
import type { SecureTokenStore } from './types';

export * from './types';
export * from './memory';
export * from './durable';

export function createTokenStore(): SecureTokenStore {
  return new DurableTokenStore();
}

export const defaultTokenStore: SecureTokenStore = createTokenStore();
