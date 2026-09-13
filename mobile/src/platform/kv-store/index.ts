import { NativeKvStore } from './native';
import type { AsyncKeyValueStore, NativeKvStorageModule } from './types';

export * from './types';
export * from './native';
export * from './memory';

export function createKvStore(injectedModule?: NativeKvStorageModule): AsyncKeyValueStore {
  return new NativeKvStore(injectedModule);
}

export const defaultKvStore: AsyncKeyValueStore = createKvStore();
