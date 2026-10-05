import { describe, expect, it } from 'vitest'

import { POST as legacyChangePassword } from '@/app/api/auth/change-password/route'
import { GET as legacyDomainCheck } from '@/app/api/auth/domain-check/route'
import { POST as legacyForgotPassword } from '@/app/api/auth/forgot-password/route'
import { POST as legacyLogin } from '@/app/api/auth/login/route'
import { POST as legacyLogout } from '@/app/api/auth/logout/route'
import { GET as legacyMe } from '@/app/api/auth/me/route'
import { POST as legacyResetPassword } from '@/app/api/auth/reset-password/route'
import { POST as legacyRevokeMobileSessions } from '@/app/api/auth/revoke-mobile-sessions/route'
import { POST as legacySignup } from '@/app/api/auth/signup/route'
import { POST as browserChangePassword } from '@/app/api/v1/auth/browser/change-password/route'
import { GET as browserDomainCheck } from '@/app/api/v1/auth/browser/domain-check/route'
import { POST as browserForgotPassword } from '@/app/api/v1/auth/browser/forgot-password/route'
import { POST as browserLogin } from '@/app/api/v1/auth/browser/login/route'
import { POST as browserLogout } from '@/app/api/v1/auth/browser/logout/route'
import { GET as browserMe } from '@/app/api/v1/auth/browser/me/route'
import { POST as browserResetPassword } from '@/app/api/v1/auth/browser/reset-password/route'
import { POST as browserRevokeMobileSessions } from '@/app/api/v1/auth/browser/revoke-mobile-sessions/route'
import { POST as browserSignup } from '@/app/api/v1/auth/browser/signup/route'

describe('v1 browser auth route aliases', () => {
  it('shares the exact legacy browser handlers during the rollback window', () => {
    expect(browserLogin).toBe(legacyLogin)
    expect(browserLogout).toBe(legacyLogout)
    expect(browserMe).toBe(legacyMe)
    expect(browserSignup).toBe(legacySignup)
    expect(browserDomainCheck).toBe(legacyDomainCheck)
    expect(browserForgotPassword).toBe(legacyForgotPassword)
    expect(browserResetPassword).toBe(legacyResetPassword)
    expect(browserChangePassword).toBe(legacyChangePassword)
    expect(browserRevokeMobileSessions).toBe(legacyRevokeMobileSessions)
  })
})
