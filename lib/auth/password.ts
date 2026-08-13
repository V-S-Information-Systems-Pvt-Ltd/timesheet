// lib/auth/password.ts
// Scrypt password hashing for the native (cloud-native) backend. Uses Node's
// built-in crypto so there is no native-addon dependency and no external auth
// service. Hash format: "<salt-hex>:<derived-key-hex>".

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const KEY_LENGTH = 64

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, KEY_LENGTH)
  return `${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false

  const derived = await scrypt(password, salt, KEY_LENGTH)
  const expected = Buffer.from(hash, 'hex')
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
