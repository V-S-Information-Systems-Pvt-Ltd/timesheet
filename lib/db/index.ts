// lib/db/index.ts
// Backend-aware repository dispatch. Server code imports `repo` and talks to
// the active backend without knowing which one it is.

import { IS_NATIVE } from '@/lib/backend'
import { nativeRepository } from './native'
import { supabaseRepository } from './supabase'
import type { Repository } from './repository'

export const repo: Repository = IS_NATIVE ? nativeRepository : supabaseRepository

export type { Actor, DbWrite, Repository } from './repository'
