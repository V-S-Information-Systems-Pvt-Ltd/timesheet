// lib/backend/client.ts
// Client-side backend selector. Import this from client components to pick the
// same adapter the server is using.

export { BACKEND, BACKENDS, IS_NATIVE, IS_SUPABASE, resolveBackend } from './config'
export type { Backend } from './config'
