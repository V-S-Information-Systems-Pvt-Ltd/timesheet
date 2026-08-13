// app/components/cn.ts
// Minimal class-name joiner shared by the UI modules.
export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}
