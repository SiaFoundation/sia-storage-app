import type { SdkAuthAdapter } from '@siastorage/core/stores'
import { createContext, useContext } from 'react'

export type AuthActions = SdkAuthAdapter

export const AuthContext = createContext<AuthActions | null>(null)

export function useAuth(): AuthActions {
  const ctx = useContext(AuthContext)
  if (!ctx)
    throw new Error('useAuth must be used within an AuthContext.Provider')
  return ctx
}
