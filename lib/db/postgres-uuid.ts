/** Normalize PostgreSQL UUID input spellings without imposing version/variant rules. */
export function normalizePostgresUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.startsWith('{') && value.endsWith('}') ? value.slice(1, -1) : value
  // PostgreSQL permits a hyphen after any four hex digits, except at the end.
  // Use an absolute end assertion: `$` also matches before a final newline.
  if (!/^(?:[0-9a-f]{4}-?){7}[0-9a-f]{4}(?![\s\S])/i.test(text)) return null
  const hex = text.replaceAll('-', '').toLowerCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
