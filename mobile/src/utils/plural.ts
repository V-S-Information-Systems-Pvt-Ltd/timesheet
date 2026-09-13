/**
 * Count-aware wording for entry totals.
 *
 * The list header and the report screens previously hard-coded the plural form
 * ("1 entries logged"), so these helpers keep the singular/plural decision in
 * one place.
 */
export function entryWord(count: number): 'entry' | 'entries' {
  return count === 1 ? 'entry' : 'entries';
}

/** Formats a count with the correct noun, e.g. `1 entry`, `3 entries`. */
export function formatEntryCount(count: number): string {
  return `${count} ${entryWord(count)}`;
}
