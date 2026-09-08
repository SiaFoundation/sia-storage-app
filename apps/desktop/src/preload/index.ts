/*
 * The contextBridge surface.
 *
 * The renderer gets these functions and nothing else. No Node, no ipcRenderer,
 * no require. `rpc` reaches the daemon's facade, the same one the CLI calls.
 */

import type { IpcMessage } from '@siastorage/core/app'
import type { ChangeEvent } from '@siastorage/core/types'
import { contextBridge, ipcRenderer } from 'electron'

/** One cache mutation the daemon made, replayed by a client holding its own. */
export type CacheMessage = IpcMessage

const api = {
  /** Calls a reflected AppService method, e.g. `ds:settings:getIndexerURL`. */
  rpc: (method: string, args: unknown[] = []) => ipcRenderer.invoke('rpc', method, args),

  daemonReachable: () => ipcRenderer.invoke('shell:daemon'),
  shellStatus: () => ipcRenderer.invoke('shell:status'),
  mountPath: () => ipcRenderer.invoke('shell:mountPath'),

  /** Reports the height the content needs, so the popover can size to it. */
  reportHeight: (height: number) => ipcRenderer.send('window:height', height),

  openUrl: (url: string) => ipcRenderer.invoke('open:url', url),
  /** Asks the daemon to wire an SDK from a key stored since it came up. */
  connectDaemon: () => ipcRenderer.invoke('daemon:connect'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  openMount: () => ipcRenderer.invoke('open:mount'),
  showMoreMenu: () => ipcRenderer.invoke('menu:more'),
  quit: () => ipcRenderer.invoke('app:quit'),

  /** Fires when the library, the connection or sync state changes. */
  onChange: (listener: (event: ChangeEvent) => void) => {
    const handler = (_event: unknown, payload: ChangeEvent) => listener(payload)
    ipcRenderer.on('change', handler)
    return () => ipcRenderer.removeListener('change', handler)
  },

  /** Fires with each cache change the daemon made, for this window to apply. */
  onCache: (listener: (message: CacheMessage) => void) => {
    const handler = (_event: unknown, payload: CacheMessage) => listener(payload)
    ipcRenderer.on('cache', handler)
    return () => ipcRenderer.removeListener('cache', handler)
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld('sia', api)

export type SiaApi = typeof api
