'use client'

import React, { createContext, useContext } from 'react'
import type { WorkspaceBranding } from '@/app/types'
import { DEFAULT_BRANDING } from '@/lib/branding'

const BrandingContext = createContext<WorkspaceBranding>(DEFAULT_BRANDING)

export function BrandingProvider({
  branding,
  children,
}: {
  branding: WorkspaceBranding
  children: React.ReactNode
}) {
  return (
    <BrandingContext.Provider value={branding || DEFAULT_BRANDING}>
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding(): WorkspaceBranding {
  return useContext(BrandingContext) || DEFAULT_BRANDING
}
