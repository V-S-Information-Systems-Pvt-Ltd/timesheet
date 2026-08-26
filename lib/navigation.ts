export type AppNavKey = 'dashboard' | 'reports'

/** Pending accounts may view the approval screen, but not the application data views. */
export function visibleAppNavKeys(isActive: boolean): AppNavKey[] {
  return isActive ? ['dashboard', 'reports'] : ['dashboard']
}

/**
 * Which full-screen account view the dashboard should render once the session
 * and profile load have settled. A failed or missing profile must never be
 * presented as "pending approval" — that claims an account state we don't know.
 */
export type AccountView = 'error' | 'pending' | 'ready'

export function classifyAccountView(
  profile: { is_active: boolean } | null,
  profileError: string | null
): AccountView {
  if (profileError || !profile) return 'error'
  return profile.is_active ? 'ready' : 'pending'
}
