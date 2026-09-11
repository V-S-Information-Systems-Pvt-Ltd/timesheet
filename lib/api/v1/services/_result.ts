export type MobileServiceResult<T> =
  | { success: true; data: T; status?: number }
  | { success: false; code: string; message: string; status: number }
