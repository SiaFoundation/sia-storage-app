/*
 * The preload surface, typed.
 *
 * Every read goes through `rpc` onto the daemon's reflected facade, so nothing
 * here caches or derives library state; the daemon is the only source.
 */

export type ChangeEvent = { event: 'change'; scope: string }

export type SiaApi = {
  rpc(method: string, args?: unknown[]): Promise<unknown>
  daemonReachable(): Promise<boolean>
  shellStatus(): Promise<'absent' | 'starting' | 'mounted' | 'error'>
  mountPath(): Promise<string | null>
  reportHeight(height: number): void
  openMount(): Promise<void>
  openLogs(): Promise<void>
  quit(): Promise<void>
  onChange(listener: (event: ChangeEvent) => void): () => void
  onCache(listener: (message: unknown) => void): () => void
  platform: string
}

declare global {
  interface Window {
    sia: SiaApi
  }
}

// Absent only if the preload failed to load or this page is open outside
// Electron, both of which are easier to read here than at the first call.
if (!window.sia) throw new Error('The preload bridge did not load')

export const sia = window.sia
