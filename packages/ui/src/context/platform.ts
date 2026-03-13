import { createContext, useContext } from 'react'

export type PlatformActions = {
  uploadFiles: (files: File[]) => Promise<Record<string, string>>
  saveFileToDisk: (
    data: ArrayBuffer,
    fileName: string,
    mimeType: string,
  ) => void
  createBlobUrl: (data: ArrayBuffer, mimeType: string) => string
  softReset: () => Promise<void>
  fullReset: () => Promise<void>
  signOutAndReset: () => Promise<void>
}

export const PlatformContext = createContext<PlatformActions | null>(null)

export function usePlatform(): PlatformActions {
  const ctx = useContext(PlatformContext)
  if (!ctx) {
    throw new Error(
      'usePlatform must be used within a PlatformContext.Provider',
    )
  }
  return ctx
}
