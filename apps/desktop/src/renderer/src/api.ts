/*
 * The preload surface, typed.
 *
 * Every read goes through `rpc` onto the daemon's reflected facade, so nothing
 * here caches or derives library state; the daemon is the only source.
 */

import type { IpcMessage } from '@siastorage/core/app'
import type { ChangeEvent } from '@siastorage/core/types'
import type { DomainState } from './model'

export type { ChangeEvent }

export type SiaApi = {
  rpc(method: string, args?: unknown[], timeoutMs?: number): Promise<unknown>
  daemonReachable(): Promise<boolean>
  shellStatus(): Promise<DomainState>
  mountPath(): Promise<string | null>
  reportHeight(height: number): void
  openUrl(url: string): Promise<void>
  connectDaemon(): Promise<{ connected: boolean }>
  closeWindow(): Promise<void>
  openMount(): Promise<void>
  /** Opens the menu holding the actions the footer has no room for. */
  showMoreMenu(): Promise<void>
  quit(): Promise<void>
  onChange(listener: (event: ChangeEvent) => void): () => void
  onCache(listener: (message: IpcMessage) => void): () => void
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
