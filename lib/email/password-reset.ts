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
    html: [
      '<p>We received a request to reset your VSIS Timesheet password.</p>',
      `<p><a href="${url}">Reset your password</a></p>`,
      `<p>This link expires at ${expires} and can be used only once.</p>`,
      '<p>If you did not request this, you can safely ignore this email.</p>',
    ].join(''),
  })
}
