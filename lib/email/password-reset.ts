import 'server-only'

import nodemailer, { type Transporter } from 'nodemailer'

let transporter: Transporter | null = null

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured.`)
  return value
}

function getTransporter(): Transporter {
  if (transporter) return transporter

  const host = required('SMTP_HOST')
  const port = Number(process.env.SMTP_PORT || '587')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port.')
  }

  const user = process.env.SMTP_USER?.trim()
  const password = process.env.SMTP_PASSWORD
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    ...(user ? { auth: { user, pass: password ?? '' } } : {}),
  })
  return transporter
}

function appBaseUrl(): string {
  const value = required('APP_BASE_URL').replace(/\/+$/, '')
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('APP_BASE_URL must use http or https.')
  }
  return parsed.toString().replace(/\/+$/, '')
}

export function passwordResetUrl(token: string): string {
  // A fragment keeps the raw token out of the initial request URL, server
  // access logs, and Referer headers. The reset page submits it in the body.
  return `${appBaseUrl()}/reset-password#token=${encodeURIComponent(token)}`
}

export async function sendPasswordResetEmail(input: {
  to: string
  token: string
  expiresAt: Date
}): Promise<void> {
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim()
  if (!from) throw new Error('SMTP_FROM or SMTP_USER is not configured.')

  const url = passwordResetUrl(input.token)
  const expires = input.expiresAt.toUTCString()
  await getTransporter().sendMail({
    from,
    to: input.to,
    subject: 'Reset your VSIS Timesheet password',
    text: [
      'We received a request to reset your VSIS Timesheet password.',
      '',
      `Reset your password: ${url}`,
      '',
      `This link expires at ${expires} and can be used only once.`,
      'If you did not request this, you can safely ignore this email.',
    ].join('\n'),
    html: passwordResetHtml(url, expires),
  })
}

// Email clients ignore <style> and flexbox, so layout is tables with inline
// styles. Colours mirror the Pulse tokens in app/globals.css.
export function passwordResetHtml(url: string, expires: string): string {
  const logo = `${appBaseUrl()}/brand/vsis-logo-compact.jpg`
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c252e;">
<div style="display:none;max-height:0;overflow:hidden;">Use this link to reset your VSIS Timesheet password.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #dfe3e8;border-radius:12px;">
<tr><td style="padding:28px 32px 0;">
<img src="${logo}" alt="VSIS" height="40" style="display:block;height:40px;border:0;">
</td></tr>
<tr><td style="padding:24px 32px 8px;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;">Reset your password</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#454f5b;">We received a request to reset the password for your VSIS Timesheet account. Select the button below to choose a new one.</p>
</td></tr>
<tr><td style="padding:20px 32px;">
<a href="${url}" style="display:inline-block;background:#007867;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">Reset password</a>
</td></tr>
<tr><td style="padding:0 32px 24px;">
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#637381;">This link expires at ${expires} and can be used only once.</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#637381;">Button not working? Paste this link into your browser:<br><a href="${url}" style="color:#007867;word-break:break-all;">${url}</a></p>
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e9ecee;">
<p style="margin:0;font-size:12px;line-height:1.6;color:#919eab;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

export function emailVerificationUrl(token: string): string {
  return `${appBaseUrl()}/verify-email#token=${encodeURIComponent(token)}`
}

export async function sendEmailVerificationEmail(input: {
  to: string
  token: string
  expiresAt: Date
}): Promise<void> {
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim()
  if (!from) throw new Error('SMTP_FROM or SMTP_USER is not configured.')

  const url = emailVerificationUrl(input.token)
  const expires = input.expiresAt.toUTCString()
  await getTransporter().sendMail({
    from,
    to: input.to,
    subject: 'Confirm your VSIS Timesheet email address',
    text: [
      'Someone created a VSIS Timesheet account with this email address.',
      '',
      `Confirm your address: ${url}`,
      '',
      `This link expires at ${expires} and can be used only once.`,
      'If this was not you, ignore this email; the account stays inactive.',
    ].join('\n'),
    html: [
      '<p>Someone created a VSIS Timesheet account with this email address.</p>',
      `<p><a href="${url}">Confirm your address</a></p>`,
      `<p>This link expires at ${expires} and can be used only once.</p>`,
      '<p>If this was not you, ignore this email; the account stays inactive.</p>',
    ].join(''),
  })
}
