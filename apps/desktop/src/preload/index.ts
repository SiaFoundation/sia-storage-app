/*
 * The contextBridge surface.
 *
 * The renderer gets these functions and nothing else. No Node, no ipcRenderer,
 * no require. `rpc` reaches the daemon's facade, the same one the CLI calls.
 */

import type { ChangeEvent } from '@siastorage/core/types'
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  /** Calls a reflected AppService method, e.g. `ds:settings:getIndexerURL`. */
  rpc: (method: string, args: unknown[] = []) => ipcRenderer.invoke('rpc', method, args),

  daemonReachable: () => ipcRenderer.invoke('shell:daemon'),
  shellStatus: () => ipcRenderer.invoke('shell:status'),
  mountPath: () => ipcRenderer.invoke('shell:mountPath'),

  /** Reports the height the content needs, so the popover can size to it. */
  reportHeight: (height: number) => ipcRenderer.send('window:height', height),

  openMount: () => ipcRenderer.invoke('open:mount'),
  openLogs: () => ipcRenderer.invoke('open:logs'),
  quit: () => ipcRenderer.invoke('app:quit'),

  /** Fires when the library, the connection or sync state changes. */
  onChange: (listener: (event: ChangeEvent) => void) => {
    const handler = (_event: unknown, payload: ChangeEvent) => listener(payload)
    ipcRenderer.on('change', handler)
    return () => ipcRenderer.removeListener('change', handler)
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld('sia', api)

export type SiaApi = typeof api
