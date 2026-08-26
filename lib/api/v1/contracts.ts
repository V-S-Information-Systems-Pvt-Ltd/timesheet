import { z } from 'zod'

export const mobileLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  deviceName: z.string().trim().max(120).optional(),
  platform: z.enum(['android', 'ios', 'windows']).optional(),
})

export const mobileRefreshSchema = z.object({
  refreshToken: z.string().min(1),
})

export interface MobileActorDto {
  id: string
  email: string
  /** Legacy single role, kept in sync server-side. */
  role: string
  /** Authorization role. */
  permissionRole: string
  /** Reporting position. */
  hierarchyRole: string
  isActive: boolean
}

export interface MobileLoginData {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string
  sessionId: string
  actor: MobileActorDto
}

export type MobileApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } }
