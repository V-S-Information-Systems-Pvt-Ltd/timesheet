// lib/secret-env.ts
// Shared validation for server signing/HMAC secrets. Dependency-free so the
// edge-safe JWT helpers can use it.
//
// Length alone is not enough: the committed examples (deploy/secret.yaml,
// .env.example) are 33 characters, so a deployment that forgot to replace them
// would otherwise run with a publicly known key and anyone could forge
// sessions. Values that still carry a placeholder marker are rejected.

const MIN_SECRET_LENGTH = 32
const PLACEHOLDER = /change[-_ ]?me|placeholder/i

/** True when `value` still carries a committed placeholder marker. */
export function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER.test(value)
}

/** Why `value` is unusable as a secret, or null when it is acceptable. */
export function secretProblem(name: string, value: string | undefined): string | null {
  if (!value || value.length < MIN_SECRET_LENGTH) {
    return `${name} must be configured with at least ${MIN_SECRET_LENGTH} characters.`
  }
  if (isPlaceholderSecret(value)) {
    return `${name} still holds a placeholder value; set a long random secret.`
  }
  return null
}

/** Read a required secret from the environment, throwing when it is unusable. */
export function readSecret(name: string): string {
  const value = process.env[name]
  const problem = secretProblem(name, value)
  if (problem) throw new Error(problem)
  return value as string
}
