import { afterEach, describe, expect, it, vi } from 'vitest'
import { passwordResetHtml, passwordResetUrl } from '@/lib/email/password-reset'

describe('passwordResetHtml', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('renders the reset link, logo and expiry', () => {
    vi.stubEnv('APP_BASE_URL', 'https://ts.example.com/')
    const url = passwordResetUrl('tok')
    const html = passwordResetHtml(url, 'Thu, 22 Oct 2026 10:00:00 GMT')
    expect(html.match(/href="https:\/\/ts\.example\.com\/reset-password#token=tok"/g)).toHaveLength(2)
    expect(html).toContain('src="https://ts.example.com/brand/vsis-logo-compact.jpg"')
    expect(html).toContain('Thu, 22 Oct 2026 10:00:00 GMT')
  })

  it('fails without APP_BASE_URL', () => {
    vi.stubEnv('APP_BASE_URL', '')
    expect(() => passwordResetHtml('x', 'y')).toThrow('APP_BASE_URL is not configured.')
  })
})
