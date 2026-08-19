// lib/notifications.ts
// Lightweight in-memory notification bus for cross-component real-time updates.
// For production scale, replace with SSE or a service like Pusher.

type Listener = (message: string) => void

const listeners = new Set<Listener>()

export function onNotification(cb: Listener): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function emitNotification(message: string) {
  for (const cb of listeners) {
    try { cb(message) } catch { /* noop */ }
  }
}
