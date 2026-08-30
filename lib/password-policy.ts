/**
 * lib/password-policy.ts
 * Zero-dependency password policy validator used by both client UI forms and
 * server validation schemas to guarantee 100% rule parity without bundling Zod.
 */

export interface PasswordValidationResult {
  ok: boolean
  error?: string
}

export function validatePasswordPolicy(password: string): PasswordValidationResult {
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' }
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, error: 'Password must include at least one uppercase letter.' }
  }
  if (!/[a-z]/.test(password)) {
    return { ok: false, error: 'Password must include at least one lowercase letter.' }
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, error: 'Password must include at least one digit.' }
  }
  return { ok: true }
}
