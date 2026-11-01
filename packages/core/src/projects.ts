/** Marks projects closed to this department as hidden, so pickers drop them.
 * Mirrors the server's projectEligibility rule, which still enforces it. */
export function scopeProjects<P extends { is_hidden?: boolean; departments?: string[] | null }>(
  projects: P[],
  department?: string | null
): P[] {
  return projects.map(p =>
    p.departments?.length && !(department && p.departments.includes(department)) ? { ...p, is_hidden: true } : p
  )
}
