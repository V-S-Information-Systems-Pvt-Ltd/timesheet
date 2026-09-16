// Supabase CLI records parsed statements without the delimiters and whitespace
// between them. Compare each recorded statement exactly against the local SQL,
// allowing only whitespace/semicolons at statement boundaries. Do not collapse
// whitespace inside statements: that could hide changes to strings or bodies.
export function matchesRecordedMigrationStatements(source, statements) {
  if (!Array.isArray(statements) || statements.length === 0) return false

  const sql = source.replace(/\r\n/g, '\n')
  let offset = 0
  for (const recorded of statements) {
    if (typeof recorded !== 'string') return false
    const statement = recorded.replace(/\r\n/g, '\n').trim()
    if (!statement) return false

    const position = sql.indexOf(statement, offset)
    if (position < 0 || !/^[\s;]*$/.test(sql.slice(offset, position))) return false
    offset = position + statement.length
  }
  return /^[\s;]*$/.test(sql.slice(offset))
}
