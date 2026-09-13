export type MobileServiceResult<T> =
  | { success: true; data: T; status?: number }
  | { success: false; code: string; message: string; status: number }

export function rateLimitedResult<T>(message: string): MobileServiceResult<T> {
  return { success: false, code: 'RATE_LIMITED', message, status: 429 }
}

export function isSuccessful<T>(result: MobileServiceResult<T>): boolean {
  return result.success
}
