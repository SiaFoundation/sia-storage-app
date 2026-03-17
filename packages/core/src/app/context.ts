import { createContext, useContext } from 'react'
import type { AppService } from './service'

const AppServiceContext = createContext<AppService | null>(null)

/** React context provider that supplies the AppService instance to the component tree. */
export const AppProvider = AppServiceContext.Provider

/** Returns the current AppService instance from context, or throws if no provider is mounted. */
export function useApp(): AppService {
  const app = useContext(AppServiceContext)
  if (!app) throw new Error('AppProvider not found')
  return app
}
