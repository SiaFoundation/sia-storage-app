/*
 * Runs the AppService across an IPC boundary (desktop main process and
 * renderer). registerAppServiceIpc exposes every service method as an
 * invoke channel and broadcasts cache mutations; createRemoteAppService
 * builds a call-forwarding proxy on the other side and replays those
 * cache messages into its local caches so hooks re-render.
 */
import { swrCacheBy } from '../stores/swr'
import { createLibraryVersionCache } from './libraryVersionCache'
import type { AppCaches, AppService } from './service'

type IpcMessage = {
  kind: 'cache'
  path: string[]
  method: string
  args: unknown[]
}

function isSwrCache(obj: unknown): boolean {
  return typeof obj === 'object' && obj !== null && 'key' in obj && 'invalidate' in obj
}

function isLibraryVersionCache(obj: unknown): boolean {
  return typeof obj === 'object' && obj !== null && 'subscribe' in obj && 'getVersion' in obj
}

function installCacheBroadcasting(caches: AppCaches, broadcast: (msg: IpcMessage) => void): void {
  function walk(obj: Record<string, any>, path: string[]) {
    if (isSwrCache(obj)) {
      const origInvalidate = obj.invalidate
      const origInvalidateAll = obj.invalidateAll
      const origSet = obj.set
      obj.invalidate = (...parts: string[]) => {
        broadcast({ kind: 'cache', path, method: 'invalidate', args: parts })
        return origInvalidate(...parts)
      }
      obj.invalidateAll = () => {
        broadcast({
          kind: 'cache',
          path,
          method: 'invalidateAll',
          args: [],
        })
        return origInvalidateAll()
      }
      obj.set = (data: unknown, ...parts: string[]) => {
        broadcast({
          kind: 'cache',
          path,
          method: 'set',
          args: [data, ...parts],
        })
        return origSet(data, ...parts)
      }
      return
    }
    if (isLibraryVersionCache(obj)) {
      const origInvalidate = obj.invalidate
      obj.invalidate = () => {
        broadcast({
          kind: 'cache',
          path,
          method: 'invalidate',
          args: [],
        })
        origInvalidate()
      }
      return
    }
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'object' && val !== null) {
        walk(val, [...path, key])
      }
    }
  }
  walk(caches as Record<string, any>, [])
}

export function registerAppServiceIpc(
  ipcMain: {
    handle(channel: string, handler: (...args: any[]) => any): void
  },
  service: AppService,
  send?: (channel: string, data: unknown) => void,
): AppService {
  function walkMethods(obj: Record<string, any>, prefix: string) {
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'caches') continue
      const channel = `${prefix}:${key}`
      if (typeof val === 'function') {
        ipcMain.handle(channel, (_event: any, ...args: any[]) => val(...args))
      } else if (typeof val === 'object' && val !== null) {
        walkMethods(val, channel)
      }
    }
  }
  walkMethods(service as Record<string, any>, 'ds')

  if (send) {
    const broadcast = (msg: IpcMessage) => send('app-msg', msg)
    installCacheBroadcasting(service.caches, broadcast)
  }

  return service
}

function applyCacheMessage(caches: AppCaches, msg: IpcMessage) {
  if (msg.kind !== 'cache') return
  let target: any = caches
  for (const key of msg.path) {
    target = target?.[key]
  }
  if (target && typeof target[msg.method] === 'function') {
    target[msg.method](...msg.args)
  }
}

export function createRemoteAppService(
  invoke: (channel: string, ...args: any[]) => Promise<any>,
  onMessage?: (handler: (msg: IpcMessage) => void) => () => void,
): AppService {
  const caches: AppCaches = {
    tags: swrCacheBy(),
    directories: swrCacheBy(),
    library: swrCacheBy(),
    imports: swrCacheBy(),
    fileById: swrCacheBy(),
    thumbnails: {
      best: swrCacheBy(),
      byFileId: swrCacheBy(),
    },
    fsFileUri: swrCacheBy<string | null>(),
    libraryVersion: createLibraryVersionCache(),
    settings: swrCacheBy(),
    sync: swrCacheBy(),
    uploads: swrCacheBy(),
    downloads: swrCacheBy(),
    connection: swrCacheBy(),
    init: swrCacheBy(),
    sdk: swrCacheBy(),
    hosts: swrCacheBy(),
  }

  if (onMessage) {
    onMessage((msg: IpcMessage) => {
      if (msg.kind === 'cache') {
        applyCacheMessage(caches, msg)
      }
    })
  }

  // The client can't know whether a property is a leaf method or a deeper
  // namespace, so each one is both callable and traversable.
  function proxyAt(prefix: string): any {
    const memo: Record<string, any> = {}
    return new Proxy(
      {},
      {
        get(_, key: string) {
          if (key === 'caches') return caches
          if (!(key in memo)) {
            const channel = `${prefix}:${key}`
            const fn = (...args: any[]) => invoke(channel, ...args)
            memo[key] = new Proxy(fn, {
              get(_, subKey: string) {
                if (subKey === 'caches') return caches
                return proxyAt(channel)[subKey]
              },
            })
          }
          return memo[key]
        },
      },
    )
  }

  return proxyAt('ds') as AppService
}
