import type { ApiClient } from '../../api/client';

export type WithAuth = <T>(
  fn: (client: ApiClient, token: string) => Promise<T>,
  options?: { defaultValue?: T; errorMessage?: string }
) => Promise<T>;
