// lib/auth/registration-service.ts
// Provider-neutral registration service that owns normalization,
// eligibility rules, password hashing, and conflict handling.

import { hashPassword } from '@/lib/auth/password'
import { passwordSchema } from '@/lib/validation-schemas'
import type { RegistrationPort } from './registration'

export interface RegisterUserInput {
  email?: unknown
  password?: unknown
  name?: unknown
}

export type RegistrationOutcome =
  | {
      ok: true
      data: {
        success: true
        isActive: boolean
        message: string
        userId: string
      }
    }
  | {
      ok: false
      error: {
        code: 'VALIDATION_ERROR' | 'DOMAIN_NOT_ALLOWED' | 'ACCOUNT_EXISTS' | 'UNSUPPORTED'
        message: string
      }
    }

/**
 * Register a new user identity. Owns validation, email normalization,
 * domain whitelist checks, password complexity validation, hashing,
 * and database race conflict handling.
 */
export async function registerUser(
  body: RegisterUserInput,
  port: RegistrationPort
): Promise<RegistrationOutcome> {
  const { email, password, name } = body ?? {}

  if (typeof email !== 'string' || typeof password !== 'string') {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Email and password are required.',
      },
    }
  }

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please enter a valid email address.',
      },
    }
  }

  const pwdCheck = passwordSchema.safeParse(password)
  if (!pwdCheck.success) {
    const msg = pwdCheck.error.issues[0]?.message ?? 'Password does not meet complexity requirements.'
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: msg,
      },
    }
  }

  const displayName = typeof name === 'string' ? name.trim() : ''
  if (displayName.length > 200) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Name is too long.',
      },
    }
  }

  const domain = normalizedEmail.split('@')[1]?.toLowerCase()
  if (!domain) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid email address.',
      },
    }
  }

  const whitelisted = await port.findWhitelistedDomain(domain)
  if (!whitelisted) {
    return {
      ok: false,
      error: {
        code: 'DOMAIN_NOT_ALLOWED',
        message: `Registration is not allowed for @${domain}. Contact an administrator.`,
      },
    }
  }

  const exists = await port.accountExists(normalizedEmail)
  if (exists) {
    return {
      ok: false,
      error: {
        code: 'ACCOUNT_EXISTS',
        message: 'An account with that email already exists.',
      },
    }
  }

  const hash = await hashPassword(password)
  const isActive = Boolean(whitelisted.autoActivate)

  try {
    const registered = await port.registerIdentity({
      email: normalizedEmail,
      name: displayName,
      passwordHash: hash,
      isActive,
    })

    return {
      ok: true,
      data: {
        success: true,
        isActive,
        message: isActive
          ? 'Account created and activated! You can now sign in.'
          : 'Account created! An administrator must activate your account before you can log time.',
        userId: registered.id,
      },
    }
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (('code' in err && (err as { code?: string }).code === 'CONFLICT') ||
        ('code' in err && (err as { code?: string }).code === '23505') ||
        ('message' in err && String((err as Error).message).includes('already exists')))
    ) {
      return {
        ok: false,
        error: {
          code: 'ACCOUNT_EXISTS',
          message: 'An account with that email already exists.',
        },
      }
    }
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'UNSUPPORTED'
    ) {
      const message = err instanceof Error ? err.message : 'Operation unsupported'
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED',
          message,
        },
      }
    }
    throw err
  }
}

export type DomainEligibilityOutcome =
  | {
      ok: true
      data: {
        allowed: boolean
        autoActivate: boolean
      }
    }
  | {
      ok: false
      error: string
    }

/**
 * Pre-signup domain whitelist eligibility lookup.
 * Checks whether an email's domain is whitelisted and whether registrations
 * from it auto-activate. Non-enumerating and unauthenticated.
 */
export async function checkDomainEligibility(
  email: string | null | undefined,
  port: RegistrationPort
): Promise<DomainEligibilityOutcome> {
  const normalized = (email ?? '').trim().toLowerCase()
  const domain = normalized.split('@')[1]?.toLowerCase()
  if (!domain) {
    return { ok: false, error: 'Please enter a valid email address.' }
  }

  const whitelisted = await port.findWhitelistedDomain(domain)
  if (!whitelisted) {
    return { ok: true, data: { allowed: false, autoActivate: false } }
  }
  return { ok: true, data: { allowed: true, autoActivate: Boolean(whitelisted.autoActivate) } }
}
