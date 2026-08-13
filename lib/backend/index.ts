// lib/backend/index.ts
// Server-side backend selector. Import this from server code (server actions,
// route handlers, repositories).

export { BACKEND, BACKENDS, IS_NATIVE, IS_SUPABASE, resolveBackend } from './config'
export type { Backend } from './config'
